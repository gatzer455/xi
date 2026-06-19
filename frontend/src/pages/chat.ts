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

import { appState } from '../lib/state.ts';
import { createScope, type Page } from '../lib/scope.ts';
import { ChatBubble } from '../components/chat-bubble.ts';

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

  scope.add(appState.messages.subscribe(renderMessages));

  messagesContainer.append(messagesInner);
  root.append(messagesContainer);

  return { root, dispose: () => scope.dispose() };
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
