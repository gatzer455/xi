/**
 * chat.ts — Vista de chat del output board (Capa 1 + Capa 3).
 *
 * Historial de mensajes del chat. El input vive en el shell
 * (input.ts), no acá — es always-visible, independiente de la
 * vista activa. Esta vista solo renderiza el header + mensajes.
 *
 * Conectado con pi via pi-rpc.ts (los mensajes vienen de
 * appState.messages, populados por state-sync.ts).
 *
 * ## Auto-scroll
 *
 * El scroll al fondo es notoriamente difícil en chats con contenido
 * async (markdown, syntax highlight, fuentes web, imágenes). Tres
 * técnicas combinadas, según el patrón profesional de Slack/Discord/
 * vercel-chatbot/lsm-neokai:
 *
 * 1. **Sentinel element** — un `<div>` invisible al final de los
 *    mensajes. Usamos `scrollIntoView({block:'end'})` sobre el
 *    sentinel, no `scrollTop = scrollHeight` (que se rompe cuando
 *    el contenido crece async).
 *
 * 2. **Initial pin (doble rAF + reflow forzado)** — al renderizar
 *    los mensajes, esperamos 2 frames y forzamos reflow. El doble
 *    rAF garantiza que el browser completó el layout de los
 *    ChatBubble antes de scrollear.
 *
 * 3. **ResizeObserver con "stick to bottom"** — si el contenedor
 *    crece DESPUÉS del pin inicial (markdown async, fonts web),
 *    re-scrolleamos solo si el usuario está "near bottom". Si el
 *    usuario scrolleó arriba para leer, no lo jalamos de vuelta
 *    (anti-scroll-jacking).
 *
 * El sentinel es siempre el último hijo de messagesInner (incluso
 * en el estado vacío con el welcome). El CSS `scroll-padding-bottom`
 * agrega espacio para que el último mensaje no quede pegado al borde.
 */

import { appState, type ExtensionDialogState } from '../lib/state.ts';
import { createScope, type Page } from '../lib/scope.ts';
import { ChatBubble } from '../components/chat-bubble.ts';
import { renderSelectDialog, renderConfirmDialog, renderInputDialog, renderEditorDialog } from '../components/extension-ui-dialog.ts';
import { setDialogRenderer, clearDialogRenderer } from '../lib/pi/extension-ui-handler.ts';

/** Distancia máxima al fondo (en px) para considerar "near bottom". */
const NEAR_BOTTOM_PX = 100;

export function ChatPage(): Page {
  const root = document.createElement('div');
  root.className = 'chat-area';
  const scope = createScope();

  // ═══ Header (modelo actual) ═══
  const header = document.createElement('div');
  header.className = 'chat-header';

  const title = document.createElement('h1');
  title.className = 'chat-header-title';
  title.textContent = 'xi';
  header.append(title);

  const modelBadge = document.createElement('span');
  modelBadge.className = 'chat-header-model';
  modelBadge.textContent = 'sin modelo';
  scope.add(appState.currentModel.subscribe(model => {
    modelBadge.textContent = model ? model.name : 'sin modelo';
  }));
  header.append(modelBadge);

  root.append(header);

  // ═══ Messages ═══
  const messagesContainer = document.createElement('div');
  messagesContainer.className = 'chat-messages';

  const messagesInner = document.createElement('div');
  messagesInner.className = 'chat-messages-inner';

  // Sentinel: anclaje invisible al final de los mensajes. Vivir
  // siempre como último hijo de messagesInner (incluso en estado
  // vacío). scrollIntoView sobre el sentinel es robusto a cambios
  // async del scrollHeight — el browser recalcula cada vez.
  const endSentinel = document.createElement('div');
  endSentinel.className = 'chat-end-sentinel';

  // Flag para el pin inicial. Se setea en true después del primer
  // render y nunca se resetea (cada vez que se monta la página,
  // ChatPage se recrea, así que el flag arranca en false). En
  // renders posteriores (mensajes nuevos), el ResizeObserver hace
  // stick-to-bottom — no se llama pinToBottom otra vez.
  let hasPinnedOnFirstRender = false;

  /** ¿El usuario está cerca del fondo del scroll? */
  function isNearBottom(): boolean {
    const distance = messagesContainer.scrollHeight
      - messagesContainer.scrollTop
      - messagesContainer.clientHeight;
    return distance <= NEAR_BOTTOM_PX;
  }

  function renderMessages(messages: typeof appState.messages.value) {
    // Wipe: quitamos todo (incluyendo el sentinel viejo).
    messagesInner.replaceChildren();

    if (messages.length === 0) {
      const welcome = renderWelcome();
      messagesInner.append(welcome);
    } else {
      for (const msg of messages) {
        messagesInner.append(ChatBubble(msg));
      }
    }

    // El sentinel SIEMPRE va al final, después de cualquier contenido.
    // scrollIntoView lo usa como ancla para el scroll al fondo.
    messagesInner.append(endSentinel);

    // Pin al fondo SOLO en el primer render. Los siguientes renders
    // (mensajes nuevos, tool results) usan el ResizeObserver con
    // stick-to-bottom (solo scrollea si el usuario está near bottom).
    // Esto evita scroll-jacking: si el usuario está scrolled up
    // leyendo, no lo mandamos al fondo cuando llega un mensaje.
    if (!hasPinnedOnFirstRender) {
      hasPinnedOnFirstRender = true;
      pinToBottom();
    }
  }

  /** Pin inmediato al fondo. Usado SOLO en el primer render
   *  de esta página (después de cargar sesión / cambiar tab).
   *  Para actualizaciones posteriores, el ResizeObserver hace
   *  stick-to-bottom con guard isNearBottom(). */
  function pinToBottom(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Forzar reflow: leer una propiedad de layout hace que el
        // browser complete cualquier layout pendiente antes de
        // continuar. Sin esto, scrollIntoView mide alturas
        // incorrectas.
        void messagesContainer.offsetHeight;
        endSentinel.scrollIntoView({ block: 'end', behavior: 'instant' });
      });
    });
  }

  /** Re-pin reactivo: cuando el contenido crece async (markdown,
   *  fonts web, imágenes), re-scrolleamos al fondo SOLO si el
   *  usuario está "near bottom". Si scrolleó arriba, respetamos
   *  su posición. */
  const resizeObserver = new ResizeObserver(() => {
    if (isNearBottom()) {
      endSentinel.scrollIntoView({ block: 'end', behavior: 'instant' });
    }
  });

  // Observamos messagesInner. Cuando su altura cambia (porque un
  // ChatBubble terminó de layout-ear async), re-evaluamos.
  resizeObserver.observe(messagesInner);

  // Cleanup: desconectar el observer al desmontar.
  scope.add(() => resizeObserver.disconnect());

  // NOTA: botón "Jump to latest" cuando el usuario está scrolled up
  // (no cerca del fondo) está anotado en NOTAS.md. Cuando lo
  // implementemos, se setea un flag en el scroll listener.

  // ─── Extension UI Dialog ────────────────────────────────
  // Cuando una extensión de pi pide interacción (select, confirm, etc.),
  // se renderiza un dialog al final del chat. El usuario responde y
  // el dialog se reemplaza por un mensaje del usuario.

  let activeDialogContainer: HTMLElement | null = null;

  function renderExtensionDialog(dialog: ExtensionDialogState): void {
    // Remover dialog anterior si existe
    removeExtensionDialog();

    activeDialogContainer = document.createElement('div');
    activeDialogContainer.className = 'extension-dialog-wrapper';

    let dialogElement: HTMLElement;

    switch (dialog.method) {
      case 'select':
        dialogElement = renderSelectDialog(
          { type: 'extension_ui_request', id: dialog.id, method: 'select', title: dialog.title, options: dialog.options ?? [] },
          dialog.resolve,
          dialog.reject,
        );
        break;
      case 'confirm':
        dialogElement = renderConfirmDialog(
          { type: 'extension_ui_request', id: dialog.id, method: 'confirm', title: dialog.title, message: dialog.message ?? '' },
          dialog.resolve,
          dialog.reject,
        );
        break;
      case 'input':
        dialogElement = renderInputDialog(
          { type: 'extension_ui_request', id: dialog.id, method: 'input', title: dialog.title, placeholder: dialog.placeholder },
          dialog.resolve,
          dialog.reject,
        );
        break;
      case 'editor':
        dialogElement = renderEditorDialog(
          { type: 'extension_ui_request', id: dialog.id, method: 'editor', title: dialog.title, prefill: dialog.prefill },
          dialog.resolve,
          dialog.reject,
        );
        break;
      default:
        console.error(`[chat] Unknown extension dialog method: ${dialog.method}`);
        dialog.reject();
        return;
    }

    activeDialogContainer.appendChild(dialogElement);

    // Insertar antes del sentinel para que scrollIntoView lo muestre
    messagesInner.insertBefore(activeDialogContainer, endSentinel);

    // Scroll al dialog
    requestAnimationFrame(() => {
      activeDialogContainer?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    });

    // Escape para cancelar
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', handleKeyDown);
        dialog.reject();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    // Limpiar listener cuando el dialog se remueve
    scope.add(() => document.removeEventListener('keydown', handleKeyDown));
  }

  function removeExtensionDialog(): void {
    if (activeDialogContainer) {
      activeDialogContainer.remove();
      activeDialogContainer = null;
    }
  }

  // Acumular respuestas del ask para mostrarlas como un solo bloque
  // al final de todas las preguntas (no una por pregunta).
  let askResponses: Array<{ question: string; answer: string }> = [];

  // Registrar el renderer con el handler de extension-ui
  setDialogRenderer((_method, request) => {
    return new Promise((resolve, reject) => {
      // Wrap resolve/reject para limpiar el dialog.
      // NO agregamos messages del usuario — las respuestas se muestran
      // como un bloque formateado al final.
      const wrappedResolve = (value: Record<string, unknown>) => {
        const answer = formatDialogResponse(request.method, value);
        if (answer) {
          askResponses.push({ question: request.title, answer });
        }
        appState.activeExtensionDialog.value = null;
        resolve(value);
      };

      const wrappedReject = () => {
        askResponses.push({ question: request.title, answer: '(cancelled)' });
        appState.activeExtensionDialog.value = null;
        reject();
      };

      appState.activeExtensionDialog.value = {
        id: request.id,
        method: request.method,
        title: ('title' in request) ? request.title : '',
        message: ('message' in request) ? request.message : undefined,
        options: ('options' in request) ? request.options : undefined,
        placeholder: ('placeholder' in request) ? request.placeholder : undefined,
        prefill: ('prefill' in request) ? request.prefill : undefined,
        resolve: wrappedResolve,
        reject: wrappedReject,
      };
    });
  });

  // Cuando el dialog se cierra (se resuelve o cancela), si hay
  // respuestas acumuladas, agregar un solo bloque formateado al chat.
  scope.add(appState.activeExtensionDialog.subscribe((dialog) => {
    if (dialog) {
      renderExtensionDialog(dialog);
    } else {
      removeExtensionDialog();
      // Mostrar respuestas acumuladas como un solo tool result
      if (askResponses.length > 0) {
        addAskResult(askResponses);
        askResponses = [];
      }
    }
  }));

  scope.add(appState.messages.subscribe(renderMessages));

  messagesContainer.append(messagesInner);
  root.append(messagesContainer);

  return {
    root,
    dispose: () => {
      clearDialogRenderer();
      appState.activeExtensionDialog.value = null;
      scope.dispose();
    },
  };
}

/**
 * Agregar el resultado de un ask tool como un solo tool result.
 *
 * En vez de agregar un message del usuario por cada respuesta,
 * se muestra un bloque formateado con todas las preguntas y respuestas.
 * Se ve como un output de tool, no como un message del usuario.
 */
function addAskResult(responses: Array<{ question: string; answer: string }>): void {
  const id = `ask-result-${Date.now()}`;
  const lines = responses.map(r => `**${r.question}** → ${r.answer}`);
  const content = lines.join('\n');

  const message = {
    id,
    role: 'toolResult' as const,
    content,
    timestamp: Date.now(),
    toolResult: {
      toolName: 'ask',
      isError: false,
    },
  };
  appState.messages.value = [...appState.messages.value, message];
}

/**
 * Formatear la respuesta del dialog para mostrarla como mensaje del usuario.
 *
 * Convierte el objeto de respuesta a un string legible.
 */
function formatDialogResponse(method: string, value: Record<string, unknown>): string {
  switch (method) {
    case 'select':
      return String(value.value ?? '');
    case 'confirm':
      return value.confirmed ? 'Sí' : 'No';
    case 'input':
      return String(value.value ?? '');
    case 'editor':
      return String(value.value ?? '');
    default:
      return JSON.stringify(value);
  }
}

/** Renderiza la pantalla de bienvenida (estado vacío). */
function renderWelcome(): HTMLElement {
  const welcome = document.createElement('div');
  welcome.className = 'welcome';

  const icon = document.createElement('div');
  icon.className = 'welcome-icon';
  icon.textContent = '✦';
  welcome.append(icon);

  const welcomeTitle = document.createElement('h2');
  welcomeTitle.className = 'welcome-title';
  welcomeTitle.textContent = '¿En qué puedo ayudarte?';
  welcome.append(welcomeTitle);

  const subtitle = document.createElement('p');
  subtitle.className = 'welcome-subtitle';
  subtitle.textContent = appState.workingDir.value
    ? 'Escribe un mensaje para comenzar una conversación con pi.'
    : 'Selecciona una carpeta de trabajo para comenzar.';
  welcome.append(subtitle);

  return welcome;
}
