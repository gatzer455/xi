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
import { ChatBubble, type ChatBubbleHandle } from 'xi-ui/components/chat-bubble.ts';
import { getStore, type ChatStore } from 'xi-ui/lib/chat/stores.ts';
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

export function ChatPage(): Page {
  const root = document.createElement('div');
  root.className = 'chat-area';
  const scope = createScope();

  const { messagesContainer, messagesInner, endSentinel } = createMessagesContainer();
  root.append(messagesContainer);

  const scroll = createAutoScroll({ container: messagesContainer, sentinel: endSentinel });

  const bubbleHandles = new Map<string, ChatBubbleHandle>();

  function renderMessages(messages: ChatMessage[]): void {
    renderMessagesInto(messagesInner, endSentinel, bubbleHandles, messages, scroll.pinToBottom);
  }

  let currentStore: ChatStore | null = null;
  let unsubMessages: (() => void) | null = null;

  function bindActiveTab(tabId: string | null): void {
    unsubMessages?.();
    unsubMessages = null;
    currentStore = null;

    if (!tabId) {
      renderEmptyStateInto(messagesInner, endSentinel);
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
    messagesInner,
    endSentinel,
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

// ═══════════════════════════════════════════════════════════

function createMessagesContainer() {
  const messagesContainer = document.createElement('div');
  messagesContainer.className = 'chat-messages';

  const messagesInner = document.createElement('div');
  messagesInner.className = 'chat-messages-inner';

  const endSentinel = document.createElement('div');
  endSentinel.className = 'chat-end-sentinel';

  messagesContainer.append(messagesInner);
  messagesInner.append(endSentinel);

  return { messagesContainer, messagesInner, endSentinel };
}

function createAutoScroll(opts: { container: HTMLElement; sentinel: HTMLElement }) {
  const { container, sentinel } = opts;
  let hasPinnedOnFirstRender = false;

  function pinToBottom(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void container.offsetHeight;
        sentinel.scrollIntoView({ block: 'end', behavior: 'instant' });
      });
    });
  }

  return {
    pinToBottom: (): void => {
      if (!hasPinnedOnFirstRender) {
        hasPinnedOnFirstRender = true;
        pinToBottom();
      }
    },
  };
}

function renderMessagesInto(
  messagesInner: HTMLElement,
  endSentinel: HTMLElement,
  bubbleHandles: Map<string, ChatBubbleHandle>,
  messages: ChatMessage[],
  pinToBottom: () => void,
): void {
  if (messages.length === 0) {
    for (const handle of bubbleHandles.values()) handle.dispose();
    bubbleHandles.clear();
    messagesInner.replaceChildren();
    messagesInner.append(renderEmptyState());
    messagesInner.append(endSentinel);
    pinToBottom();
    return;
  }

  const emptyState = messagesInner.querySelector('.chat-empty-state');
  if (emptyState) emptyState.remove();

  const seenIds = new Set<string>();
  for (const msg of messages) {
    seenIds.add(msg.id);
    const existing = bubbleHandles.get(msg.id);
    if (existing) {
      existing.update(msg);
    } else {
      const handle = ChatBubble(msg);
      bubbleHandles.set(msg.id, handle);
    }
  }

  for (const [id, handle] of bubbleHandles) {
    if (!seenIds.has(id)) {
      handle.dispose();
      handle.root.remove();
      bubbleHandles.delete(id);
    }
  }

  let ref: ChildNode = endSentinel;
  for (let i = messages.length - 1; i >= 0; i--) {
    const handle = bubbleHandles.get(messages[i].id);
    if (!handle) continue;
    if (handle.root.nextSibling !== ref || handle.root.parentNode !== messagesInner) {
      messagesInner.insertBefore(handle.root, ref);
    }
    ref = handle.root;
  }

  pinToBottom();
}

function renderEmptyStateInto(messagesInner: HTMLElement, endSentinel: HTMLElement): void {
  messagesInner.replaceChildren();
  messagesInner.append(renderEmptyState());
  messagesInner.append(endSentinel);
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
  messagesInner: HTMLElement;
  endSentinel: HTMLElement;
  scope: ReturnType<typeof createScope>;
  getStore_: () => ChatStore | null;
  scroll: { pinToBottom: () => void };
}

function setupExtensionDialogs(opts: DialogSetupOptions) {
  const { messagesInner, endSentinel, scope, getStore_, scroll } = opts;

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
  void messagesInner;
  void endSentinel;
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
