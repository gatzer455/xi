/**
 * chat.ts — Vista de mensajes del chat (mobile).
 *
 * Adaptado de apps/desktop/frontend/src/pages/chat.ts: mismo pipeline
 * (ChatStore per-tab, ChatBubble, extension_ui dialogs vía
 * appState.activeExtensionDialog) — el único cambio real es de dónde
 * viene `setDialogRenderer`/`clearDialogRenderer` (acá, WS passthrough
 * en vez de evento Tauri, ver lib/extension-ui-handler.ts). Sin auth
 * banner (mobile no tiene pantalla de API keys — el server ya está
 * configurado por su dueño).
 */
import { appState, type ExtensionDialogState } from 'xi-ui/lib/state.ts';
import { createScope, type Page } from 'xi-ui/lib/scope.ts';
import type { ChatBubbleHandle } from 'xi-ui/components/chat-bubble.ts';
import { getStore, type ChatStore } from 'xi-ui/lib/chat/stores.ts';
import type { ChatMessage } from 'xi-ui/lib/chat/types.ts';
import {
  createMessagesContainer,
  createAutoScroll,
  renderMessagesInto,
  renderEmptyStateInto,
} from 'xi-ui/components/chat-messages.ts';
import {
  renderSelectDialog,
  renderConfirmDialog,
  renderInputDialog,
  renderEditorDialog,
} from 'xi-ui/components/extension-ui-dialog.ts';
import {
  setDialogRenderer,
  clearDialogRenderer,
} from '../lib/extension-ui-handler.ts';

export function ChatPage(): Page {
  const root = document.createElement('div');
  root.className = 'chat-area';
  const scope = createScope();

  const { messagesContainer, messagesInner, endSentinel } = createMessagesContainer();
  root.append(messagesContainer);

  const scroll = createAutoScroll(messagesContainer, endSentinel);

  const bubbleHandles = new Map<string, ChatBubbleHandle>();

  function renderMessages(messages: ChatMessage[]): void {
    renderMessagesInto(messagesInner, endSentinel, bubbleHandles, messages, scroll.pinToBottom, renderEmptyState);
  }

  let currentStore: ChatStore | null = null;
  let unsubMessages: (() => void) | null = null;

  function bindActiveTab(tabId: string | null): void {
    unsubMessages?.();
    unsubMessages = null;
    currentStore = null;

    if (!tabId) {
      renderEmptyStateInto(messagesInner, endSentinel, renderEmptyState);
      scroll.pinToBottom();
      return;
    }

    const store = getStore(tabId);
    currentStore = store;
    unsubMessages = store.messages$.subscribe(renderMessages);
  }

  scope.add(appState.activeTabId.subscribe(bindActiveTab));
  scope.add(() => {
    unsubMessages?.();
    for (const h of bubbleHandles.values()) h.dispose();
    bubbleHandles.clear();
  });

  setupExtensionDialogs({
    scope,
    getStore_: () => currentStore,
    scroll,
  });

  return {
    root,
    dispose: () => {
      clearDialogRenderer();
      appState.activeExtensionDialog.value = null;
      scope.dispose();
    },
  };
}

function renderEmptyState(): HTMLElement {
  const welcome = document.createElement('div');
  welcome.className = 'chat-empty-state';

  const title = document.createElement('h2');
  title.className = 'chat-empty-title';
  title.textContent = '¿En qué puedo ayudarte?';
  welcome.append(title);

  return welcome;
}

// ═══════════════════════════════════════════════════════════
// Extension UI Dialog (bottom sheet)
// ═══════════════════════════════════════════════════════════

interface DialogSetupOptions {
  scope: ReturnType<typeof createScope>;
  getStore_: () => ChatStore | null;
  scroll: { pinToBottom: () => void };
}

function setupExtensionDialogs(opts: DialogSetupOptions) {
  const { scope, getStore_, scroll } = opts;

  let activeDialogContainer: HTMLElement | null = null;
  let askResponses: Array<{ question: string; answer: string }> = [];

  function renderExtensionDialog(dialog: ExtensionDialogState): void {
    if (activeDialogContainer) activeDialogContainer.remove();

    activeDialogContainer = document.createElement('div');
    activeDialogContainer.className = 'extension-dialog-wrapper extension-dialog-sheet';

    let dialogElement: HTMLElement;
    switch (dialog.method) {
      case 'select':
        dialogElement = renderSelectDialog(
          { type: 'extension_ui_request', id: dialog.id, method: 'select', title: dialog.title, options: dialog.options ?? [] },
          dialog.resolve, dialog.reject,
        );
        break;
      case 'confirm':
        dialogElement = renderConfirmDialog(
          { type: 'extension_ui_request', id: dialog.id, method: 'confirm', title: dialog.title, message: dialog.message ?? '' },
          dialog.resolve, dialog.reject,
        );
        break;
      case 'input':
        dialogElement = renderInputDialog(
          { type: 'extension_ui_request', id: dialog.id, method: 'input', title: dialog.title, placeholder: dialog.placeholder },
          dialog.resolve, dialog.reject,
        );
        break;
      case 'editor':
        dialogElement = renderEditorDialog(
          { type: 'extension_ui_request', id: dialog.id, method: 'editor', title: dialog.title, prefill: dialog.prefill },
          dialog.resolve, dialog.reject,
        );
        break;
      default:
        console.error(`[chat] Unknown extension dialog method: ${dialog.method}`);
        dialog.reject();
        return;
    }

    activeDialogContainer.appendChild(dialogElement);
    document.body.appendChild(activeDialogContainer);
  }

  function removeExtensionDialog(): void {
    if (activeDialogContainer) {
      activeDialogContainer.remove();
      activeDialogContainer = null;
    }
  }

  setDialogRenderer((_method, request) => {
    return new Promise((resolve, reject) => {
      const wrappedResolve = (value: Record<string, unknown>) => {
        const answer = formatDialogResponse(request.method, value);
        if (answer) {
          const question = 'title' in request ? request.title : request.message;
          askResponses.push({ question, answer });
        }
        appState.activeExtensionDialog.value = null;
        resolve(value);
      };

      const wrappedReject = () => {
        const question = 'title' in request ? request.title : request.message;
        askResponses.push({ question, answer: '(cancelled)' });
        appState.activeExtensionDialog.value = null;
        reject();
      };

      appState.activeExtensionDialog.value = {
        id: request.id,
        method: request.method,
        title: 'title' in request ? request.title : '',
        message: 'message' in request ? request.message : undefined,
        options: 'options' in request ? request.options : undefined,
        placeholder: 'placeholder' in request ? request.placeholder : undefined,
        prefill: 'prefill' in request ? request.prefill : undefined,
        resolve: wrappedResolve,
        reject: wrappedReject,
      };
    });
  });

  scope.add(
    appState.activeExtensionDialog.subscribe((dialog) => {
      if (dialog) {
        renderExtensionDialog(dialog);
      } else {
        removeExtensionDialog();
        if (askResponses.length > 0) {
          addAskResult(askResponses, getStore_);
          askResponses = [];
          scroll.pinToBottom();
        }
      }
    }),
  );

  scope.add(removeExtensionDialog);
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

function addAskResult(
  responses: Array<{ question: string; answer: string }>,
  getStore_: () => ChatStore | null,
): void {
  const ts = Date.now();
  const lines = responses.map((r) => `**${r.question}** → ${r.answer}`);
  const output = lines.join('\n');

  const message: ChatMessage = {
    id: `toolResult_ask_${ts}`,
    role: 'toolResult',
    parts: [{
      type: 'toolResult',
      toolCallId: `ask_${ts}`,
      toolName: 'ask',
      result: { output },
      isError: false,
    }],
    timestamp: ts,
  };
  const store = getStore_();
  if (store) store.dispatch({ type: 'local_message', message });
}
