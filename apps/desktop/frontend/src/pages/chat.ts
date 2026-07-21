/**
 * chat.ts — Vista de mensajes del chat (antes ChatPage).
 *
 * Etapa 9+ (chat-architecture-v2): ChatPage SOLO contiene los mensajes.
 * El header (que tenía "xi" + modelo) y el footer (spinner "Trabajando…")
 * se movieron al shell de la app (context-bar en main.ts). Esto mantiene
 * el scroll de mensajes limpio y la barra de contexto siempre visible en
 * la parte baja del viewport.
 *
 * Arquitectura chat-architecture-v2:
 *   - Los mensajes viven en `ChatStore`s per-tab (lib/chat/stores.ts).
 *   - ChatPage se suscribe al store del activeTab. Al cambiar de tab,
 *     se desuscribe del store viejo y se suscribe al nuevo (re-render).
 *   - Los `bubbleHandles` viven en el closure de `ChatPage` (no
 *     module-level) — se limpian al desmontar la página.
 *
 *   1. Layout (messages container)
 *   2. Auto-scroll (sentinel + ResizeObserver)
 *   3. Extension UI dialogs (insertar al final)
 *   4. Suscripción al ChatStore del activeTab → renderMessages
 */

import { appState, type ExtensionDialogState } from 'xi-ui/lib/state.ts';
import { createScope, type Page } from 'xi-ui/lib/scope.ts';
import type { ChatBubbleHandle } from 'xi-ui/components/chat-bubble.ts';
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
} from '../lib/pi/extension-ui-handler.ts';
import { navigate } from 'xi-ui/lib/nav.ts';
import {
  createMessagesContainer,
  createAutoScroll,
  renderMessagesInto,
  renderEmptyStateInto,
} from 'xi-ui/components/chat-messages.ts';
import { mountExplorer } from './explorer.ts';

/** Distancia máxima al fondo (en px) para considerar "near bottom". */

export function ChatPage(): Page {
  const root = document.createElement('div');
  root.className = 'chat-area';
  const scope = createScope();

  // ═══ Banner: no hay API key configurada ═══
  const { banner: authBanner, dispose: disposeAuthBanner } = createAuthBanner();
  root.append(authBanner);

  // ═══ Content row: chat + panel lateral (split view) ═══
  const contentRow = document.createElement('div');
  contentRow.className = 'chat-content-row';
  root.append(contentRow);

  // ═══ Messages container ═══
  const { messagesContainer, messagesInner, endSentinel } =
    createMessagesContainer();
  contentRow.append(messagesContainer);

  // ═══ Explorer side panel ═══
  let explorerPanelEl: HTMLElement | null = null;
  let explorerScope: ReturnType<typeof createScope> | null = null;

  const unsubPanel = appState.explorerPanelOpen.subscribe((open) => {
    if (open && !explorerPanelEl) {
      explorerPanelEl = document.createElement('div');
      explorerPanelEl.className = 'explorer-panel';
      explorerScope = createScope();
      mountExplorer(explorerPanelEl, explorerScope);
      contentRow.append(explorerPanelEl);
      root.classList.add('chat-area--panel-open');
    } else if (!open && explorerPanelEl) {
      explorerPanelEl.remove();
      explorerScope?.dispose();
      explorerPanelEl = null;
      explorerScope = null;
      root.classList.remove('chat-area--panel-open');
    }
  });
  scope.add(unsubPanel);
  scope.add(() => {
    explorerPanelEl?.remove();
    explorerScope?.dispose();
    explorerPanelEl = null;
    explorerScope = null;
  });

  // ═══ Auto-scroll ═══
  const scroll = createAutoScroll(messagesContainer, endSentinel);

  // ═══ Render: bubbleHandles en closure (no module-level) ═══
  const bubbleHandles = new Map<string, ChatBubbleHandle>();

  function renderMessages(messages: ChatMessage[]): void {
    renderMessagesInto(messagesInner, endSentinel, bubbleHandles, messages, scroll.pinToBottom, renderEmptyState);
  }

  // ═══ Bind al ChatStore del activeTab ═══
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

  // ═══ Extension UI Dialog ═══
  setupExtensionDialogs({
    messagesInner,
    root,
    scope,
    getStore_: () => currentStore,
    bubbleHandles,
    scroll,
  });

  return {
    root,
    dispose: () => {
      disposeAuthBanner();
      clearDialogRenderer();
      appState.activeExtensionDialog.value = null;
      scope.dispose();
    },
  };
}

// ═══════════════════════════════════════════════════════════
// Auth banner
// ═══════════════════════════════════════════════════════════

function createAuthBanner(): { banner: HTMLElement; dispose: () => void } {
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

  const unsub = appState.hasAnyProvider.subscribe((hasAny) => {
    banner.style.display = hasAny ? 'none' : 'flex';
  });

  return { banner, dispose: unsub };
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
  root: HTMLElement;
  scope: ReturnType<typeof createScope>;
  getStore_: () => ChatStore | null;
  bubbleHandles: Map<string, ChatBubbleHandle>;
  scroll: { pinToBottom: () => void };
}

function setupExtensionDialogs(opts: DialogSetupOptions) {
  const { messagesInner, root, scope, getStore_, bubbleHandles, scroll } = opts;

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
    // Insertar en root (chat-area), fuera del scroll de mensajes,
    // para que el diálogo quede anclado al borde inferior de la vista.
    root.append(activeDialogContainer);

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