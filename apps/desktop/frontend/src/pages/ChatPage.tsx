/**
 * ChatPage.tsx — Vista de mensajes del chat (SolidJS).
 */
import { createSignal, Show, onCleanup, onMount } from 'solid-js';
import { appState, type ExtensionDialogState } from 'xi-ui/lib/state.ts';
import { getStore, type ChatStore } from 'xi-ui/lib/chat/stores.ts';
import type { ChatMessage } from 'xi-ui/lib/chat/types.ts';
import {
  renderSelectDialog, renderConfirmDialog, renderInputDialog, renderEditorDialog,
} from 'xi-ui/components/extension-ui-dialog.ts';
import { setDialogRenderer } from '../lib/pi/extension-ui-handler.ts';
import { navigate } from 'xi-ui/lib/nav.ts';
import { ChatMessages, createWrappedSignal } from 'xi-ui/components/ChatMessages.tsx';
import { mountExplorer } from './ExplorerPage.tsx';

export function ChatPage() {
  // ═══ Auth banner ═══
  const [hasProvider, setHasProvider] = createSignal(appState.hasAnyProvider.value);
  onCleanup(appState.hasAnyProvider.subscribe(setHasProvider));

  // ═══ Explorer panel ═══
  const [panelOpen, setPanelOpen] = createSignal(appState.explorerPanelOpen.value);
  onCleanup(appState.explorerPanelOpen.subscribe(setPanelOpen));

  // ═══ Active tab → store binding ═══
  const [tabId, setTabId] = createSignal(appState.activeTabId.value);
  const [dialog, setDialog] = createSignal(appState.activeExtensionDialog.value);
  onCleanup(appState.activeTabId.subscribe(setTabId));
  onCleanup(appState.activeExtensionDialog.subscribe(setDialog));

  const emptyMsgs: ChatMessage[] = [];
  const [messages, _setMessages] = createSignal(emptyMsgs);
  const [streaming, _setStreaming] = createSignal(false);

  let currentStore: ChatStore | null = null;
  let unsubMsgs: (() => void) | null = null;
  let unsubStream: (() => void) | null = null;

  function bindTab(id: string | null) {
    unsubMsgs?.(); unsubStream?.();
    currentStore = null;
    if (!id) { _setMessages([]); _setStreaming(false); return; }
    const store = getStore(id);
    currentStore = store;
    const [sig, u1] = createWrappedSignal(store.messages$);
    const [sig2, u2] = createWrappedSignal(store.isStreaming$);
    _setMessages(sig);
    _setStreaming(sig2);
    unsubMsgs = u1; unsubStream = u2;
  }

  bindTab(tabId());
  onCleanup(appState.activeTabId.subscribe((id) => bindTab(id)));
  onCleanup(() => { unsubMsgs?.(); unsubStream?.(); });

  // ═══ Extension dialog setup (imperativo) ═══
  let dialogContainer: HTMLDivElement | undefined;
  let dialogCleanup: (() => void) | null = null;
  let askResponses: Array<{ question: string; answer: string }> = [];

  onMount(() => {
    setDialogRenderer((_method, request: any) => {
      return new Promise((resolve, reject) => {
        const wrappedResolve = (value: Record<string, unknown>) => {
          const answer = formatDialogResponse(request.method, value);
          if (answer) askResponses.push({ question: request.title ?? request.message ?? '', answer });
          appState.activeExtensionDialog.value = null;
          resolve(value);
        };
        const wrappedReject = () => {
          askResponses.push({ question: request.title ?? request.message ?? '', answer: '(cancelled)' });
          appState.activeExtensionDialog.value = null;
          reject();
        };
        appState.activeExtensionDialog.value = {
          id: request.id, method: request.method,
          title: 'title' in request ? request.title : '',
          message: 'message' in request ? request.message : undefined,
          options: 'options' in request ? request.options : undefined,
          placeholder: 'placeholder' in request ? request.placeholder : undefined,
          prefill: 'prefill' in request ? request.prefill : undefined,
          resolve: wrappedResolve, reject: wrappedReject,
        };
      });
    });
  });

  onCleanup(() => { dialogCleanup?.(); });

  onCleanup(appState.activeExtensionDialog.subscribe((d) => {
    if (!dialogContainer) return;
    dialogContainer.replaceChildren();
    dialogCleanup?.();
    if (!d) {
      if (askResponses.length > 0) {
        addAskResult(askResponses, () => currentStore);
        askResponses = [];
      }
      return;
    }
    let el: HTMLElement;
    switch (d.method) {
      case 'select':
        el = renderSelectDialog({ type: 'extension_ui_request', id: d.id, method: 'select', title: d.title, options: d.options ?? [] }, d.resolve, d.reject);
        break;
      case 'confirm':
        el = renderConfirmDialog({ type: 'extension_ui_request', id: d.id, method: 'confirm', title: d.title, message: d.message ?? '' }, d.resolve, d.reject);
        break;
      case 'input':
        el = renderInputDialog({ type: 'extension_ui_request', id: d.id, method: 'input', title: d.title, placeholder: d.placeholder }, d.resolve, d.reject);
        break;
      case 'editor':
        el = renderEditorDialog({ type: 'extension_ui_request', id: d.id, method: 'editor', title: d.title, prefill: d.prefill }, d.resolve, d.reject);
        break;
      default: d.reject(); return;
    }
    dialogContainer.append(el);
    dialogContainer.scrollIntoView({ block: 'end', behavior: 'smooth' });
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') d.reject(); };
    document.addEventListener('keydown', handleEsc);
    dialogCleanup = () => document.removeEventListener('keydown', handleEsc);
  }));

  // ═══ Explorer panel mount ═══
  let explorerEl: HTMLDivElement | undefined;
  let explorerMounted = false;

  function setExplorerRef(el: HTMLDivElement) {
    explorerEl = el;
    if (panelOpen() && !explorerMounted) {
      mountExplorer(el, undefined);
      explorerMounted = true;
    }
  }

  onCleanup(appState.explorerPanelOpen.subscribe((open) => {
    if (open && explorerEl && !explorerMounted) {
      mountExplorer(explorerEl, undefined);
      explorerMounted = true;
    } else if (!open && explorerMounted && explorerEl) {
      explorerEl.replaceChildren();
      explorerMounted = false;
    }
  }));

  return (
    <div class="chat-area">
      <Show when={!hasProvider()}>
        <div class="chat-auth-banner">
          <span>⚠ No hay modelo configurado. Configura tu API key en Ajustes para empezar a conversar.</span>
          <button class="chat-auth-banner-btn" onClick={() => navigate('settings')}>Ir a Ajustes</button>
        </div>
      </Show>

      <div class="chat-content-row">
        <div class="chat-messages-container">
          <div class="messages-inner" id="messages-inner">
            <ChatMessages messages={messages} streaming={streaming} />
          </div>
        </div>

        <Show when={panelOpen()}>
          <div class="explorer-panel" ref={setExplorerRef} />
        </Show>
      </div>

      <div ref={dialogContainer} class="extension-dialog-wrapper" />

      <button class="explorer-toggle" title="Explorador de archivos"
              classList={{ active: panelOpen() }}
              onClick={() => { appState.explorerPanelOpen.value = !panelOpen(); }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
    </div>
  );
}

function formatDialogResponse(method: string, value: Record<string, unknown>): string {
  switch (method) {
    case 'select': return String(value.value ?? '');
    case 'confirm': return value.confirmed ? 'Sí' : 'No';
    case 'input': return String(value.value ?? '');
    case 'editor': return String(value.value ?? '');
    default: return JSON.stringify(value);
  }
}

function addAskResult(responses: Array<{ question: string; answer: string }>, getStore_: () => ChatStore | null): void {
  const ts = Date.now();
  const output = responses.map((r) => `**${r.question}** → ${r.answer}`).join('\n');
  const message: ChatMessage = {
    id: `toolResult_ask_${ts}`, role: 'toolResult',
    parts: [{ type: 'toolResult', toolCallId: `ask_${ts}`, toolName: 'ask', result: { output }, isError: false }],
    timestamp: ts,
  };
  getStore_()?.dispatch({ type: 'local_message', message });
}
