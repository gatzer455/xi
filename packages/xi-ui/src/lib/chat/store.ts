/**
 * store.ts — ChatStore: wrapper reactivo sobre el reducer puro.
 *
 * Cada tab/sesión tiene su propio ChatStore. El store guarda el
 * `ChatState` interno, despacha `ChatEvent`s al reducer, y expone
 * signals (`messages$`, `isStreaming$`) para que los componentes
 * se suscriban.
 *
 * Decisiones de diseño:
 * - D2: el reducer es puro; el store es el único componente con
 *   estado mutable (el `state` interno). Pero la mutación está
 *   encapsulada: solo `dispatch` la toca, y siempre via `reduce`.
 * - R4.2: las signals se actualizan SOLO si el valor cambió
 *   (comparación por referencia del slice del state). Esto evita
 *   re-renders innecesarios cuando un event es no-op.
 *
 * El store NO sabe nada de pi, ni de Tauri, ni del DOM. Solo conoce
 * ChatState, ChatEvent, y signals. La integración con pi vive en
 * `state-sync.ts` (etapa 4).
 */

import { signal, type Signal } from '../signal.ts';
import type { ChatMessage, ChatSession, ChatState, SessionId } from './types.ts';
import { reduce, initialChatState, type ChatEvent } from './reducer.ts';

// ─── Tipos ────────────────────────────────────────────────

export interface ChatStore {
  /** ID de la sesión/tab que este store representa. */
  readonly sessionId: SessionId;
  /** Messages del chat. Se actualiza cuando el reducer cambia
   *  `state.messages` (por referencia, no por contenido). */
  readonly messages$: Signal<ChatMessage[]>;
  /** true si pi está generando una respuesta en esta sesión. */
  readonly isStreaming$: Signal<boolean>;
  /** Despacha un evento al reducer. Única forma de mutar el state. */
  dispatch(event: ChatEvent): void;
  /** Snapshot del state actual. Para tests y debugging. */
  getState(): ChatState;
}

// ─── Factory ──────────────────────────────────────────────

/** Crea un ChatStore para una sesión/tab.
 *
 *  `sessionId` es el ID del tab de xi (no el de pi). El `session`
 *  inicial puede ser null si todavía no se cargó la sesión de pi;
 *  se popula después con un evento `init` o `response_get_state`. */
export function createChatStore(
  sessionId: SessionId,
  session: ChatSession | null = null,
): ChatStore {
  let state: ChatState = initialChatState(session);

  const messages$ = signal<ChatMessage[]>(state.messages);
  const isStreaming$ = signal<boolean>(state.isStreaming);

  function dispatch(event: ChatEvent): void {
    const prev = state;
    const next = reduce(prev, event);
    // Si el reducer devolvió la misma referencia (no-op), no hacer nada.
    if (next === prev) return;
    state = next;
    // Actualizar signals solo si el slice cambió (por referencia).
    if (next.messages !== prev.messages) messages$.value = next.messages;
    if (next.isStreaming !== prev.isStreaming) isStreaming$.value = next.isStreaming;
  }

  return {
    sessionId,
    messages$,
    isStreaming$,
    dispatch,
    getState: () => state,
  };
}
