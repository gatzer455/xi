/**
 * chat.ts — Vista de chat del output board.
 *
 * Arquitectura chat-architecture-v2:
 *   - Los mensajes viven en `ChatStore`s per-tab (lib/chat/stores.ts).
 *   - ChatPage se suscribe al store del activeTab. Al cambiar de tab,
 *     se desuscribe del store viejo y se suscribe al nuevo (re-render).
 *   - Los `bubbleHandles` viven en el closure de `ChatPage` (no
 *     module-level) — se limpian al desmontar la página.
 *   - El footer "Trabajando…" es un OVERLAY transparente al fondo del
 *     chat-area (fuera de flujo, position absolute) para que su
 *     aparición/desaparición NO reflowe el markdown de los mensajes.
 *     Se suscribe al `appState.isStreaming` GLOBAL, no al `isStreaming$`
 *     per-tab: "pi está trabajando" es un hecho global de la app, no
 *     de la tab visible — y la señal global se libera de forma fiable
 *     en agent_end y terminated.
 *
 *   1. Layout (header + messages container + dialogs)
 *   2. Auto-scroll (sentinel + ResizeObserver)
 *   3. Extension UI dialogs (insertar al final)
 *   4. Suscripción al ChatStore del activeTab → renderMessages
 */

import { appState, type ExtensionDialogState } from '../lib/state.ts';
import { createScope, type Page } from '../lib/scope.ts';
import { ChatBubble, type ChatBubbleHandle } from '../components/chat-bubble.ts';
import { ChatFooter, type ChatFooterHandle } from '../components/chat-footer.ts';
import { getStore, type ChatStore } from '../lib/chat/stores.ts';
import type { ChatMessage } from '../lib/chat/types.ts';
import {
  renderSelectDialog,
  renderConfirmDialog,
  renderInputDialog,
  renderEditorDialog,
} from '../components/extension-ui-dialog.ts';
import {
  setDialogRenderer,
  clearDialogRenderer,
} from '../lib/pi/extension-ui-handler.ts';
import { navigate } from '../lib/nav.ts';

/** Distancia máxima al fondo (en px) para considerar "near bottom". */
const NEAR_BOTTOM_PX = 100;

export function ChatPage(): Page {
  const root = document.createElement('div');
  root.className = 'chat-area';
  const scope = createScope();

  // ═══ Header ═══
  const headerHandle = createHeader(scope);
  root.append(headerHandle.root);

  // ═══ Banner: no hay API key configurada ═══
  const authBanner = createAuthBanner();
  root.append(authBanner);

  // ═══ Messages container ═══
  const { messagesContainer, messagesInner, endSentinel } =
    createMessagesContainer();
  root.append(messagesContainer);

  // ═══ Footer: "Trabajando…" + spinner braille (Etapa 8) ═══
  const footer: ChatFooterHandle = ChatFooter();
  root.append(footer.root);

  // ═══ Auto-scroll ═══
  const scroll = createAutoScroll({
    container: messagesContainer,
    sentinel: endSentinel,
    inner: messagesInner,
    scope,
  });

  // ═══ Render: bubbleHandles en closure (no module-level) ═══
  const bubbleHandles = new Map<string, ChatBubbleHandle>();

  function renderMessages(messages: ChatMessage[]): void {
    renderMessagesInto(messagesInner, endSentinel, bubbleHandles, messages, scroll.pinToBottom);
  }

  // ═══ Bind al ChatStore del activeTab ═══
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

  // Footer visible solo mientras hay un stream activo GLOBALMENTE.
  // Es un overlay fuera de flujo, así que no reflowea los mensajes.
  scope.add(appState.isStreaming.subscribe((streaming) => {
    footer.setVisible(streaming);
  }));
  scope.add(appState.activeTabId.subscribe(bindActiveTab));
  scope.add(() => {
    unsubMessages?.();
    footer.setVisible(false);
    footer.dispose();
    for (const h of bubbleHandles.values()) h.dispose();
    bubbleHandles.clear();
  });

  // ═══ Extension UI Dialog ═══
  setupExtensionDialogs({
    messagesInner,
    endSentinel,
    scope,
    getStore_: () => currentStore,
    bubbleHandles,
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
// Header
// ═══════════════════════════════════════════════════════════

interface HeaderHandle {
  root: HTMLElement;
}

function createHeader(scope: ReturnType<typeof createScope>): HeaderHandle {
  const header = document.createElement('div');
  header.className = 'chat-header';

  const title = document.createElement('h1');
  title.className = 'chat-header-title';
  title.textContent = 'xi';
  header.append(title);

  const statusGroup = document.createElement('div');
  statusGroup.className = 'chat-header-status';

  const modelBadge = document.createElement('span');
  modelBadge.className = 'chat-header-model';
  modelBadge.textContent = 'sin modelo';
  statusGroup.append(modelBadge);

  header.append(statusGroup);

  scope.add(
    appState.currentModel.subscribe((model) => {
      modelBadge.textContent = model ? model.name : 'sin modelo';
    }),
  );

  return { root: header };
}

// ═══════════════════════════════════════════════════════════
// Auth banner
// ═══════════════════════════════════════════════════════════

function createAuthBanner(): HTMLElement {
  const banner = document.createElement('div');
  banner.className = 'chat-auth-banner';
  banner.style.display = 'none';

  const msg = document.createElement('span');
  msg.textContent =
    '⚠ No hay modelo configurado. Configura tu API key en Ajustes para empezar a conversar.';
  banner.append(msg);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chat-auth-banner-btn';
  btn.textContent = 'Ir a Ajustes';
  btn.addEventListener('click', () => navigate('settings'));
  banner.append(btn);

  appState.hasAnyProvider.subscribe((hasAny) => {
    banner.style.display = hasAny ? 'none' : 'flex';
  });

  return banner;
}

// ═══════════════════════════════════════════════════════════
// Messages container
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

// ═══════════════════════════════════════════════════════════
// Auto-scroll
// ═══════════════════════════════════════════════════════════

interface AutoScrollOptions {
  container: HTMLElement;
  sentinel: HTMLElement;
  inner: HTMLElement;
  scope: ReturnType<typeof createScope>;
}

function createAutoScroll(opts: AutoScrollOptions) {
  const { container, sentinel, inner, scope } = opts;

  let hasPinnedOnFirstRender = false;
  let pauseAutoScroll = false;

  function isNearBottom(): boolean {
    const distance =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    return distance <= NEAR_BOTTOM_PX;
  }

  function pinToBottom(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void container.offsetHeight;
        sentinel.scrollIntoView({ block: 'end', behavior: 'instant' });
      });
    });
  }

  inner.addEventListener(
    'toggle',
    (e) => {
      if (e.target instanceof HTMLDetailsElement) {
        pauseAutoScroll = true;
        setTimeout(() => { pauseAutoScroll = false; }, 300);
      }
    },
    true,
  );

  const resizeObserver = new ResizeObserver(() => {
    if (pauseAutoScroll) return;
    if (isNearBottom()) {
      sentinel.scrollIntoView({ block: 'end', behavior: 'instant' });
    }
  });

  resizeObserver.observe(inner);
  scope.add(() => resizeObserver.disconnect());

  return {
    pinToBottom: (): void => {
      if (!hasPinnedOnFirstRender) {
        hasPinnedOnFirstRender = true;
        pinToBottom();
      }
    },
  };
}

// ═══════════════════════════════════════════════════════════
// Render
// ═══════════════════════════════════════════════════════════

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

  // Re-attach en orden antes del sentinel.
  for (const handle of bubbleHandles.values()) {
    if (handle.root.parentNode !== messagesInner) {
      messagesInner.insertBefore(handle.root, endSentinel);
    } else {
      messagesInner.insertBefore(handle.root, endSentinel);
    }
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

  const icon = document.createElement('div');
  icon.className = 'chat-empty-icon';
  icon.textContent = '✦';
  welcome.append(icon);

  const title = document.createElement('h2');
  title.className = 'chat-empty-title';
  title.textContent = '¿En qué puedo ayudarte?';
  welcome.append(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'chat-empty-subtitle';
  subtitle.textContent = appState.workingDir.value
    ? 'Escribe un mensaje para comenzar una conversación.'
    : 'Selecciona una carpeta de trabajo para comenzar.';
  welcome.append(subtitle);

  return welcome;
}

// ═══════════════════════════════════════════════════════════
// Extension UI Dialog
// ═══════════════════════════════════════════════════════════

interface DialogSetupOptions {
  messagesInner: HTMLElement;
  endSentinel: HTMLElement;
  scope: ReturnType<typeof createScope>;
  getStore_: () => ChatStore | null;
  bubbleHandles: Map<string, ChatBubbleHandle>;
  scroll: { pinToBottom: () => void };
}

function setupExtensionDialogs(opts: DialogSetupOptions) {
  const { messagesInner, endSentinel, scope, getStore_, bubbleHandles, scroll } = opts;

  let activeDialogContainer: HTMLElement | null = null;
  let dialogKeydownCleanup: (() => void) | null = null;
  let askResponses: Array<{ question: string; answer: string }> = [];

  function renderExtensionDialog(dialog: ExtensionDialogState): void {
    if (dialogKeydownCleanup) dialogKeydownCleanup();
    if (activeDialogContainer) activeDialogContainer.remove();

    activeDialogContainer = document.createElement('div');
    activeDialogContainer.className = 'extension-dialog-wrapper';

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
    messagesInner.insertBefore(activeDialogContainer, endSentinel);

    requestAnimationFrame(() => {
      activeDialogContainer?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', handleKeyDown);
        dialog.reject();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    const cleanup = () => document.removeEventListener('keydown', handleKeyDown);
    scope.add(cleanup);
    dialogKeydownCleanup = cleanup;
  }

  function removeExtensionDialog(): void {
    dialogKeydownCleanup?.();
    dialogKeydownCleanup = null;
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
          const question = "title" in request ? request.title : request.message;
          askResponses.push({ question, answer });
        }
        appState.activeExtensionDialog.value = null;
        resolve(value);
      };

      const wrappedReject = () => {
        const question = "title" in request ? request.title : request.message;
        askResponses.push({ question, answer: "(cancelled)" });
        appState.activeExtensionDialog.value = null;
        reject();
      };

      appState.activeExtensionDialog.value = {
        id: request.id,
        method: request.method,
        title: "title" in request ? request.title : "",
        message: "message" in request ? request.message : undefined,
        options: "options" in request ? request.options : undefined,
        placeholder: "placeholder" in request ? request.placeholder : undefined,
        prefill: "prefill" in request ? request.prefill : undefined,
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