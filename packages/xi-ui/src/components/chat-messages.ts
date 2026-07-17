/**
 * chat-messages.ts — Contenedor + render de la lista de mensajes del chat.
 *
 * Extraído de los chat.ts de desktop y mobile (eran copias casi literales).
 * Lo único que difiere entre apps es el empty state (desktop muestra ícono
 * y subtítulo según workingDir; mobile solo un título) — por eso
 * `renderEmptyState` entra como parámetro en vez de vivir acá.
 */
import { ChatBubble, type ChatBubbleHandle } from './chat-bubble.ts';
import type { ChatMessage } from '../lib/chat/types.ts';

export function createMessagesContainer(): {
  messagesContainer: HTMLElement;
  messagesInner: HTMLElement;
  endSentinel: HTMLElement;
} {
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

/** Scroll manual: solo pinea al fondo UNA vez, en el primer render
 *  (abrir una sesión con historial arranca abajo; durante streaming
 *  no se fuerza el scroll — el usuario manda). */
export function createAutoScroll(
  container: HTMLElement,
  sentinel: HTMLElement,
): { pinToBottom: () => void } {
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

export function renderMessagesInto(
  messagesInner: HTMLElement,
  endSentinel: HTMLElement,
  bubbleHandles: Map<string, ChatBubbleHandle>,
  messages: ChatMessage[],
  pinToBottom: () => void,
  renderEmptyState: () => HTMLElement,
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

  // Re-attach SOLO los nodos que están fuera de orden. Mover un nodo ya
  // colocado con insertBefore lo desasocia y re-inserta → fuerza repaint.
  // Hacerlo con TODOS los bubbles en cada emisión de messages$ (~cada 50ms
  // durante streaming) hacía parpadear el final de cada mensaje —incluido
  // el anterior ya completo— en sincronía con el que se escribe.
  // Recorremos en orden inverso posicionando cada nodo antes de `ref`;
  // en streaming estable (orden sin cambios) no se mueve nada.
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

export function renderEmptyStateInto(
  messagesInner: HTMLElement,
  endSentinel: HTMLElement,
  renderEmptyState: () => HTMLElement,
): void {
  messagesInner.replaceChildren();
  messagesInner.append(renderEmptyState());
  messagesInner.append(endSentinel);
}
