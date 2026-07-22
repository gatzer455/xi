/**
 * chat.tsx — Vista de mensajes del chat (mobile).
 *
 * Reemplaza el pipeline vanilla (chat-messages.ts + chat-bubble.ts +
 * smooth-streamer.ts) con ChatMessages.tsx (SolidJS) de xi-ui.
 * Extension UI dialogs se renderizan como bottom sheet fijo, no inline.
 */
import { createSignal, createEffect, onCleanup, Show } from 'solid-js';
import { appState, type ExtensionDialogState } from 'xi-ui/lib/state.ts';
import { ChatMessages, createWrappedSignal } from 'xi-ui/components/ChatMessages.tsx';
import { getStore } from 'xi-ui/lib/chat/stores.ts';
import type { ChatMessage } from 'xi-ui/lib/chat/types.ts';
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

export function ChatPage() {
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [streaming, setStreaming] = createSignal(false);
  const [dialog, setDialog] = createSignal<ExtensionDialogState | null>(null);

  let currentStore: ReturnType<typeof getStore> | null = null;
  let unsubMessages: (() => void) | null = null;
  let askResponses: Array<{ question: string; answer: string }> = [];

  // ── Sincronizar con activeTabId ──
  function bindActiveTab(tabId: string | null) {
    unsubMessages?.();
    unsubMessages = null;
    currentStore = null;
    setMessages([]);

    if (!tabId) return;

    const store = getStore(tabId);
    currentStore = store;

    const [msgs, unsub] = createWrappedSignal(store.messages$);
    setMessages(msgs);
    unsubMessages = unsub;
  }

  createEffect(() => {
    bindActiveTab(appState.activeTabId.value);
  });

  onCleanup(() => {
    unsubMessages?.();
    clearDialogRenderer();
    appState.activeExtensionDialog.value = null;
  });

  // ── Extension UI Dialogs ──
  createEffect(() => {
    const active = appState.activeExtensionDialog.value;
    setDialog(active);
  });

  function renderDialog(d: ExtensionDialogState) {
    setDialogRenderer((_method, request) => {
      return new Promise((resolve, reject) => {
        const wrappedResolve = (value: Record<string, unknown>) => {
          const answer = formatDialogResponse(request.method, value);
          if (answer) {
            askResponses.push({
              question: 'title' in request ? request.title : request.message,
              answer,
            });
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

    return () => clearDialogRenderer();
  }

  function renderDialogContent(d: ExtensionDialogState) {
    const { id, method, title, message, options, placeholder, prefill, resolve, reject } = d;

    switch (method) {
      case 'select':
        return renderSelectDialog(
          { type: 'extension_ui_request', id, method: 'select', title, options: options ?? [] },
          resolve, reject,
        );
      case 'confirm':
        return renderConfirmDialog(
          { type: 'extension_ui_request', id, method: 'confirm', title, message: message ?? '' },
          resolve, reject,
        );
      case 'input':
        return renderInputDialog(
          { type: 'extension_ui_request', id, method: 'input', title, placeholder },
          resolve, reject,
        );
      case 'editor':
        return renderEditorDialog(
          { type: 'extension_ui_request', id, method: 'editor', title, prefill },
          resolve, reject,
        );
      default:
        reject();
        return null;
    }
  }

  return (
    <div class="chat-area">
      <ChatMessages messages={messages} streaming={streaming} />
      <Show when={dialog()}>
        {(d) => (
          <div class="extension-dialog-wrapper extension-dialog-sheet">
            {renderDialogContent(d())}
          </div>
        )}
      </Show>
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
