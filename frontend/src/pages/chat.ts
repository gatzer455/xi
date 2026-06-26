/**
 * chat.ts — Vista de chat del output board.
 *
 * Arquitectura: UN SOLO render path. ChatBubble (componente) se encarga
 * de TODO el render, incluyendo el caso de streaming (cada ChatBubble
 * se suscribe internamente a streamingText si su message tiene
 * isStreaming=true). ChatPage solo:
 *   1. Layout (header + messages container + dialogs)
 *   2. Auto-scroll (sentinel + ResizeObserver)
 *   3. Extension UI dialogs (insertar al final)
 *   4. Suscripción a appState.messages → renderMessages
 *
 * Inspiración: Claude.ai / ChatGPT / Cursor / DeepSeek.
 *
 * ## Auto-scroll
 *
 * 1. Sentinel element al final de los mensajes
 * 2. Initial pin (doble rAF + reflow forzado) en primer render
 * 3. ResizeObserver con stick-to-bottom: si el usuario está "near
 *    bottom" (≤ 100px), re-scroll; si scrolleó arriba, respetar
 * 4. <details> toggle pausa el ResizeObserver 300ms (evita scroll-jacking)
 *
 * ## Streaming
 *
 * Ya no hay subscribers paralelos. Cada ChatBubble se auto-gestiona
 * cuando isStreaming=true. El ChatPage solo re-renderiza cuando
 * `messages` cambia (mensajes nuevos, no deltas).
 */

import { appState, type ExtensionDialogState } from '../lib/state.ts';
import { createScope, type Page } from '../lib/scope.ts';
import { ChatBubble, type ChatBubbleHandle } from '../components/chat-bubble.ts';
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
  const header = createHeader(scope);
  root.append(header);

  // ═══ Banner: no hay API key configurada ═══
  const authBanner = createAuthBanner();
  root.append(authBanner);

  // ═══ Messages container ═══
  const { messagesContainer, messagesInner, endSentinel } =
    createMessagesContainer();
  root.append(messagesContainer);

  // ═══ Auto-scroll ═══
  const scroll = createAutoScroll({
    container: messagesContainer,
    sentinel: endSentinel,
    inner: messagesInner,
    scope,
  });

  // ═══ Render ═══
  scope.add(
    appState.messages.subscribe((messages) => {
      renderMessages(messagesInner, endSentinel, messages, scroll.pinToBottom);
    }),
  );

  // ═══ Extension UI Dialog ═══
  setupExtensionDialogs({
    messagesInner,
    endSentinel,
    scope,
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

function createHeader(scope: ReturnType<typeof createScope>): HTMLElement {
  const header = document.createElement('div');
  header.className = 'chat-header';

  const title = document.createElement('h1');
  title.className = 'chat-header-title';
  title.textContent = 'xi';
  header.append(title);

  // Status indicator: "pi" + estado dinámico
  const statusGroup = document.createElement('div');
  statusGroup.className = 'chat-header-status';

  const modelBadge = document.createElement('span');
  modelBadge.className = 'chat-header-model';
  modelBadge.textContent = 'sin modelo';
  statusGroup.append(modelBadge);

  // Spinner + status text (visible solo durante streaming)
  const streamingIndicator = document.createElement('span');
  streamingIndicator.className = 'chat-header-streaming';
  streamingIndicator.style.display = 'none';

  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  streamingIndicator.append(spinner);

  const streamingLabel = document.createElement('span');
  streamingLabel.textContent = 'pi está pensando…';
  streamingIndicator.append(streamingLabel);

  statusGroup.append(streamingIndicator);
  header.append(statusGroup);

  // Subscriptions
  scope.add(
    appState.currentModel.subscribe((model) => {
      modelBadge.textContent = model ? model.name : 'sin modelo';
    }),
  );
  scope.add(
    appState.isStreaming.subscribe((streaming) => {
      streamingIndicator.style.display = streaming ? 'inline-flex' : 'none';
    }),
  );

  return header;
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
      container.scrollHeight -
      container.scrollTop -
      container.clientHeight;
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

  // Pausar auto-scroll cuando el usuario expande/colapsa un <details>
  inner.addEventListener(
    'toggle',
    (e) => {
      if (e.target instanceof HTMLDetailsElement) {
        pauseAutoScroll = true;
        setTimeout(() => {
          pauseAutoScroll = false;
        }, 300);
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

// Map de messageId → ChatBubbleHandle, para update in-place
const bubbleHandles = new Map<string, ChatBubbleHandle>();

/** Remueve los bubble DOM nodes actuales (excepto el sentinel y empty state)
 *  de messagesInner, sin perder las referencias en bubbleHandles. */
function detachBubbleNodes(messagesInner: HTMLElement, endSentinel: HTMLElement): void {
  for (const handle of bubbleHandles.values()) {
    if (handle.root.parentNode === messagesInner) {
      handle.root.remove();
    }
  }
}

/** Re-inserta los bubble nodes en el orden correcto, justo antes del sentinel. */
function reattachBubbleNodes(messagesInner: HTMLElement, endSentinel: HTMLElement): void {
  // Insertamos en orden, todos antes del sentinel
  for (const handle of bubbleHandles.values()) {
    messagesInner.insertBefore(handle.root, endSentinel);
  }
}

function renderMessages(
  messagesInner: HTMLElement,
  endSentinel: HTMLElement,
  messages: typeof appState.messages.value,
  pinToBottom: () => void,
): void {
  if (messages.length === 0) {
    // Wipe handles y DOM
    for (const handle of bubbleHandles.values()) {
      handle.dispose();
    }
    bubbleHandles.clear();
    messagesInner.replaceChildren();
    messagesInner.append(renderEmptyState());
    messagesInner.append(endSentinel);
    pinToBottom();
    return;
  }

  // Si hay un empty state, removerlo
  const emptyState = messagesInner.querySelector('.chat-empty-state');
  if (emptyState) emptyState.remove();

  // Reconciliar: para cada message, si handle existe → update, si no → crear.
  // Después, dispose los handles que no están en messages.
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

  // Dispose los que ya no están
  for (const [id, handle] of bubbleHandles) {
    if (!seenIds.has(id)) {
      handle.dispose();
      handle.root.remove();
      bubbleHandles.delete(id);
    }
  }

  // Sincronizar orden en el DOM: detach todos y re-attach en orden
  // (más simple que calcular movimientos óptimos)
  detachBubbleNodes(messagesInner, endSentinel);
  reattachBubbleNodes(messagesInner, endSentinel);

  pinToBottom();
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
    ? 'Escribe un mensaje para comenzar una conversación con pi.'
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
}

function setupExtensionDialogs(opts: DialogSetupOptions) {
  const { messagesInner, endSentinel, scope } = opts;

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
          {
            type: 'extension_ui_request',
            id: dialog.id,
            method: 'select',
            title: dialog.title,
            options: dialog.options ?? [],
          },
          dialog.resolve,
          dialog.reject,
        );
        break;
      case 'confirm':
        dialogElement = renderConfirmDialog(
          {
            type: 'extension_ui_request',
            id: dialog.id,
            method: 'confirm',
            title: dialog.title,
            message: dialog.message ?? '',
          },
          dialog.resolve,
          dialog.reject,
        );
        break;
      case 'input':
        dialogElement = renderInputDialog(
          {
            type: 'extension_ui_request',
            id: dialog.id,
            method: 'input',
            title: dialog.title,
            placeholder: dialog.placeholder,
          },
          dialog.resolve,
          dialog.reject,
        );
        break;
      case 'editor':
        dialogElement = renderEditorDialog(
          {
            type: 'extension_ui_request',
            id: dialog.id,
            method: 'editor',
            title: dialog.title,
            prefill: dialog.prefill,
          },
          dialog.resolve,
          dialog.reject,
        );
        break;
      default:
        console.error(
          `[chat] Unknown extension dialog method: ${dialog.method}`,
        );
        dialog.reject();
        return;
    }

    activeDialogContainer.appendChild(dialogElement);
    messagesInner.insertBefore(activeDialogContainer, endSentinel);

    requestAnimationFrame(() => {
      activeDialogContainer?.scrollIntoView({
        block: 'end',
        behavior: 'smooth',
      });
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', handleKeyDown);
        dialog.reject();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    const cleanup = () =>
      document.removeEventListener('keydown', handleKeyDown);
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
          addAskResult(askResponses);
          askResponses = [];
        }
      }
    }),
  );
}

function formatDialogResponse(
  method: string,
  value: Record<string, unknown>,
): string {
  switch (method) {
    case "select":
      return String(value.value ?? "");
    case "confirm":
      return value.confirmed ? "Sí" : "No";
    case "input":
      return String(value.value ?? "");
    case "editor":
      return String(value.value ?? "");
    default:
      return JSON.stringify(value);
  }
}

function addAskResult(
  responses: Array<{ question: string; answer: string }>,
): void {
  const id = `ask-result-${Date.now()}`;
  const lines = responses.map((r) => `**${r.question}** → ${r.answer}`);
  const content = lines.join("\n");

  const message = {
    id,
    role: "toolResult" as const,
    content,
    timestamp: Date.now(),
    toolResult: {
      toolName: "ask",
      isError: false,
    },
  };
  appState.messages.value = [...appState.messages.value, message];
}
