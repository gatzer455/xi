/**
 * reducer.ts — Reducer puro para el estado del chat.
 *
 * `reduce(state, event) → newState`. Sin side effects, sin mutación,
 * sin variables module-level (D2). El reducer es la única forma de
 * transicionar el `ChatState` de una sesión.
 *
 * Decisiones de diseño:
 * - D5: el reducer reemplaza messages, no acumula deltas. Pi envía
 *   el message completo en cada `message_update`.
 * - D8: al reemplazar un assistant message, preservar el `state`
 *   de los ToolCallParts existentes (merge trivial de un string).
 *
 * Tests: tests/chat/reducer.test.ts (tabla-driven, inmutabilidad
 * verificada con Object.freeze).
 */

import type {
  ChatState,
  ChatMessage,
  ChatSession,
  MessageId,
  ToolCallPart,
  ToolResultPart,
  ToolState,
  Part,
} from './types.ts';

// ─── Eventos ──────────────────────────────────────────────

/** Unión discriminada de eventos que puede procesar el reducer.
 *
 *  Mapeo PiEvent → ChatEvent se hace en `state-sync.ts` (etapa 4).
 *  El reducer no sabe nada de PiEvents — solo opera sobre ChatEvents. */
export type ChatEvent =
  | { type: 'init'; session: ChatSession | null; messages: ChatMessage[] }
  | { type: 'agent_start' }
  | { type: 'message_start'; message: ChatMessage }
  | { type: 'message_update'; message: ChatMessage }
  | { type: 'message_end'; message: ChatMessage }
  | { type: 'tool_execution_start'; toolCallId: string }
  | { type: 'tool_execution_end'; toolCallId: string; isError: boolean }
  | { type: 'agent_end'; messages: ChatMessage[] }
  | { type: 'response_get_messages'; messages: ChatMessage[] }
  | { type: 'response_get_state'; session: ChatSession | null }
  /** Mensaje local (no viene de pi): ej. resultado de un dialog de
   *  extensión 'ask'. Se inserta/upserta por id. agent_end lo preserva
   *  si pi no lo reporta (es local). */
  | { type: 'local_message'; message: ChatMessage };

// ─── Reducer ──────────────────────────────────────────────

/** Reducer puro. Mismo `state` + mismo `event` → mismo resultado.
 *
 *  No muta `state`. Si un event no produce cambios (ej: tool_execution_*
 *  con toolCallId inexistente), devuelve la MISMA referencia (R3.6). */
export function reduce(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case 'init':                   return reduceInit(event.session, event.messages);
    case 'agent_start':            return { ...state, isStreaming: true };
    case 'message_start':
      // Los toolResult se mergean al ToolCallPart correspondiente
      if (event.message.role === 'toolResult') return reduceToolResultMessage(state, event.message);
      return reduceMessageStart(state, event.message);
    case 'message_update':
      if (event.message.role === 'toolResult') return reduceToolResultMessage(state, event.message);
      return reduceMessageUpdate(state, event.message);
    case 'message_end':
      if (event.message.role === 'toolResult') return reduceToolResultMessage(state, event.message);
      return reduceMessageEnd(state, event.message);
    case 'tool_execution_start':   return reduceToolExec(state, event.toolCallId, 'running');
    case 'tool_execution_end':     return reduceToolExec(state, event.toolCallId, event.isError ? 'failed' : 'completed');
    case 'agent_end':              return reduceAgentEnd(state, event.messages);
    case 'response_get_messages':  return reduceGetMessages(state, event.messages);
    case 'response_get_state':     return { ...state, session: event.session };
    case 'local_message':          return { ...state, messages: upsertMessage(state.messages, event.message) };
  }
}

// ─── init ─────────────────────────────────────────────────

function reduceInit(session: ChatSession | null, messages: ChatMessage[]): ChatState {
  return {
    session,
    messages,
    isStreaming: false,
    streamingMessageId: null,
  };
}

// ─── message lifecycle ────────────────────────────────────

function reduceMessageStart(state: ChatState, message: ChatMessage): ChatState {
  const messages = upsertMessage(state.messages, message);
  return {
    ...state,
    messages,
    isStreaming: true,
    streamingMessageId: message.id,
  };
}

/** Reemplaza el message por ID (D5). Pi envía el partial acumulado. */
function reduceMessageUpdate(state: ChatState, message: ChatMessage): ChatState {
  const existing = findMessage(state, message.id);
  // Preservar ToolCallPart.state de la versión existente (D8).
  const merged = existing ? mergeToolCallStates(message, existing) : message;
  const streaming = { ...merged, isStreaming: true };
  const messages = upsertMessage(state.messages, streaming);
  return {
    ...state,
    messages,
    isStreaming: true,
    streamingMessageId: message.id,
  };
}

function reduceMessageEnd(state: ChatState, message: ChatMessage): ChatState {
  const existing = findMessage(state, message.id);
  const finalMsg = existing ? mergeToolCallStates(message, existing) : message;
  const messages = upsertMessage(state.messages, { ...finalMsg, isStreaming: false });
  return { ...state, messages };
}

// ─── tool result → merge al ToolCallPart ──────────────────

/** Type guard: `p.type === 'toolResult'` */
function isToolResultPart(p: Part): p is ToolResultPart {
  return p.type === 'toolResult';
}

/** Cuando llega un mensaje toolResult, mergea el output al
 *  ToolCallPart correspondiente en el assistant message que lo
 *  invocó, para que los chips puedan mostrar el resultado inline.
 *  También inserta el toolResult message (por si alguien lo
 *  necesita), pero la UI no lo renderiza como bubble separado. */
function reduceToolResultMessage(state: ChatState, message: ChatMessage): ChatState {
  // Extraer el ToolResultPart
  const resultPart = message.parts.find(isToolResultPart) as ToolResultPart | undefined;
  if (!resultPart) {
    return { ...state, messages: upsertMessage(state.messages, message) };
  }

  const { toolCallId, result, isError } = resultPart;

  // Mergear el resultado en el ToolCallPart correspondiente
  const updatedMessages = state.messages.map(msg => {
    if (msg.role !== 'assistant') return msg;
    let changed = false;
    const parts = msg.parts.map(part => {
      if (part.type === 'toolCall' && part.toolCallId === toolCallId) {
        changed = true;
        return { ...part, result: { output: result.output, isError } };
      }
      return part;
    });
    return changed ? { ...msg, parts } : msg;
  });

  // Insertar/actualizar el toolResult message también
  const messages = upsertMessage(updatedMessages, message);
  return { ...state, messages };
}

// ─── tool execution ───────────────────────────────────────

/** Actualiza el state de un ToolCallPart por toolCallId (D8).
 *
 *  Si no encuentra ningún ToolCallPart con ese toolCallId, devuelve
 *  el state sin cambios (misma referencia, R3.6). */
function reduceToolExec(state: ChatState, toolCallId: string, newState: ToolState): ChatState {
  let changed = false;
  const messages = state.messages.map(msg => {
    let partChanged = false;
    const parts = msg.parts.map(part => {
      if (part.type === 'toolCall' && part.toolCallId === toolCallId) {
        // Skip si ya está en ese state (evita re-render innecesario).
        if (part.state === newState) return part;
        partChanged = true;
        changed = true;
        return { ...part, state: newState };
      }
      return part;
    });
    return partChanged ? { ...msg, parts } : msg;
  });
  return changed ? { ...state, messages } : state;
}

// ─── agent_end ────────────────────────────────────────────

/** agent_end: pi envía todos los messages finales. Reconciliamos:
 *  - Para cada message de pi, preservar ToolCallPart.state existente.
 *  - Agregar messages de xi que no están en pi (ej: user message local
 *    enviado antes de que pi confirmara con su timestamp).
 *  - isStreaming false, streamingMessageId null. */
function reduceAgentEnd(state: ChatState, piMessages: ChatMessage[]): ChatState {
  const piMap = new Map<string, ChatMessage>();
  for (const piMsg of piMessages) {
    const existing = findMessage(state, piMsg.id);
    piMap.set(piMsg.id, existing ? mergeToolCallStates(piMsg, existing) : piMsg);
  }

  // Preservar orden de state.messages: si pi tiene el msg, usar el
  // mergeado; si no, mantener el local en su posición original.
  const merged = state.messages.map(m => piMap.get(m.id) ?? m);

  // Agregar mensajes de pi que no estaban en state (ej: compaction
  // que pi insertó y state no tenía aún).
  for (const piMsg of piMessages) {
    if (!state.messages.some(m => m.id === piMsg.id)) {
      merged.push(piMsg);
    }
  }

  return {
    ...state,
    messages: merged,
    isStreaming: false,
    streamingMessageId: null,
  };
}

// ─── responses ────────────────────────────────────────────

/** get_messages: reemplaza el historial. Preserva isStreaming del
 *  message que se está streameando y tool call states locales (R3.5). */
function reduceGetMessages(state: ChatState, piMessages: ChatMessage[]): ChatState {
  const streamingId = state.streamingMessageId;
  const messages = piMessages.map(m => {
    const merged = m.id === streamingId ? { ...m, isStreaming: true } : m;
    // Preservar tool call states locales (pending→completed)
    const existing = findMessage(state, m.id);
    return existing ? mergeToolCallStates(merged, existing) : merged;
  });
  return { ...state, messages };
}

// ─── Helpers ──────────────────────────────────────────────

/** Inserta o reemplaza un message por ID. Devuelve un NUEVO array
 *  (no muta el original). Si el ID existe, reemplaza; si no, append. */
function upsertMessage(messages: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const idx = messages.findIndex(m => m.id === msg.id);
  if (idx === -1) return [...messages, msg];
  const copy = messages.slice();
  copy[idx] = msg;
  return copy;
}

function findMessage(state: ChatState, id: MessageId): ChatMessage | undefined {
  return state.messages.find(m => m.id === id);
}

/** Merge trivial (D8): preservar `state` de los ToolCallParts
 *  existentes que matcheen por toolCallId. El resto del incoming
 *  se queda tal cual (pi es source of truth para name, arguments). */
export function mergeToolCallStates(
  incoming: ChatMessage,
  existing: ChatMessage,
): ChatMessage {
  const parts: Part[] = incoming.parts.map(part => {
    if (part.type !== 'toolCall') return part;
    const existingPart = findToolCallPart(existing, part.toolCallId);
    return existingPart ? { ...part, state: existingPart.state, result: existingPart.result } : part;
  });
  return { ...incoming, parts };
}

function findToolCallPart(msg: ChatMessage, toolCallId: string): ToolCallPart | undefined {
  for (const part of msg.parts) {
    if (part.type === 'toolCall' && part.toolCallId === toolCallId) {
      return part;
    }
  }
  return undefined;
}

// ─── Estado inicial (helper para tests y stores) ──────────

/** Estado inicial estándar. Útil para tests y para crear un store. */
export function initialChatState(session: ChatSession | null = null): ChatState {
  return {
    session,
    messages: [],
    isStreaming: false,
    streamingMessageId: null,
  };
}
