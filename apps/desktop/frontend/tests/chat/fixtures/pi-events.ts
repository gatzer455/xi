/**
 * fixtures/pi-events.ts — Builders de PiEvents para tests de integración.
 *
 * Contrato: este archivo codifica los eventos que pi emite por stdout
 * (ver @earendil-works/pi-agent-core agent-loop.js). Los tests de xi
 * consumen estos builders como "entradas" — no necesitan saber si el
 * provider es GPT, Claude o un mock. Lo único relevante para xi es la
 * SECUENCIA de eventos, no su semántica de LLM.
 *
 * Separamos lo que es error de xi (estado resultante del ChatStore)
 * de lo que es error del provider (qué dice el contenido). Los
 * strings del contenido son deliberadamente trivial ("hola", "Hola
 * mundo"): la corrección de xi no depende del sentido del mensaje.
 *
 * Cada builder retorna el mismo objeto que `parsePiEvent` consumiría
 * a partir de una línea JSONL de pi. Se alimentan a `applyEvent(ev)`
 * en el orden en que pi los emite.
 */

// ─── Tipos crudos (shape de pi, no el de xi) ───────────────

export interface UserRaw {
  role: 'user';
  content: string;
  timestamp: number;
}

export interface AssistantRaw {
  role: 'assistant';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'thinking'; thinking: string }
    | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> }
  >;
  timestamp: number;
  model?: string;
  provider?: string;
  usage?: Record<string, number>;
  stopReason?: string;
}

export interface ToolResultRaw {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: { type: 'text'; text: string }[];
  isError: boolean;
  timestamp: number;
}

export type AnyRawMessage = UserRaw | AssistantRaw | ToolResultRaw;

// ─── Builders de contenido ─────────────────────────────────

/** Bloque text dentro del content de un assistant. */
function textBlock(text: string): { type: 'text'; text: string } {
  return { type: 'text', text };
}

/** Bloque thinking dentro del content de un assistant. */
function thinkingBlock(text: string): { type: 'thinking'; thinking: string } {
  return { type: 'thinking', thinking: text };
}

/** Bloque toolCall dentro del content de un assistant. */
function toolCallBlock(id: string, name: string, args: Record<string, unknown>):
  { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> } {
  return { type: 'toolCall', id, name, arguments: args };
}

// ─── Builders de mensajes crudos ───────────────────────────

export function userMessage(text: string, timestamp: number): UserRaw {
  return { role: 'user', content: text, timestamp };
}

/** Assistant parcial (sin usage/stopReason). Lo emite pi durante
 *  el streaming (message_start / message_update). */
export function assistantPartial(text: string, timestamp: number): AssistantRaw {
  return { role: 'assistant', content: [textBlock(text)], timestamp };
}

/** Assistant final con usage y stopReason. Lo emite pi en message_end
 *  y agent_end. El modelo/provider son strings decorativos — no
 *  afectan el comportamiento de xi. */
export function assistantFinal(text: string, timestamp: number): AssistantRaw {
  return {
    role: 'assistant',
    content: [textBlock(text)],
    timestamp,
    model: 'fixture-model',
    provider: 'fixture',
    usage: { input: 10, output: 20, totalTokens: 30 },
    stopReason: 'stop',
  };
}

/** Assistant que contiene un toolCall. El content text es decorativo. */
export function assistantWithToolCall(
  timestamp: number,
  toolCallId: string,
  thoughtText = 'Voy a correr un comando.',
): AssistantRaw {
  return {
    role: 'assistant',
    content: [
      textBlock(thoughtText),
      toolCallBlock(toolCallId, 'bash', { command: 'ls' }),
    ],
    timestamp,
  };
}

/** Assistant con thinking + texto (para verificar el render de thinking parts). */
export function assistantWithThinking(
  thinkingText: string,
  text: string,
  timestamp: number,
): AssistantRaw {
  return {
    role: 'assistant',
    content: [thinkingBlock(thinkingText), textBlock(text)],
    timestamp,
  };
}

export function toolResultMessage(
  toolCallId: string,
  timestamp: number,
  output: string,
  isError = false,
): ToolResultRaw {
  return {
    role: 'toolResult',
    toolCallId,
    toolName: 'bash',
    content: [textBlock(output)],
    isError,
    timestamp,
  };
}

// ─── Builders de eventos (lo que applyEvent consume) ───────

export const ev = {
  agent_start: () => ({ type: 'agent_start' as const }),
  turn_start: () => ({ type: 'turn_start' as const }),
  turn_end: () => ({ type: 'turn_end' as const }),
  message_start: (m: AnyRawMessage) => ({ type: 'message_start' as const, message: m }),
  message_update: (m: AssistantRaw, delta: string) =>
    ({ type: 'message_update' as const, message: m, assistantMessageEvent: { type: 'text_delta' as const, delta } }),
  message_end: (m: AnyRawMessage) => ({ type: 'message_end' as const, message: m }),
  tool_execution_start: (toolCallId: string, toolName = 'bash') =>
    ({ type: 'tool_execution_start' as const, toolCallId, toolName }),
  tool_execution_end: (toolCallId: string, isError = false, toolName = 'bash') =>
    ({ type: 'tool_execution_end' as const, toolCallId, isError, toolName }),
  agent_end: (messages: AnyRawMessage[]) => ({ type: 'agent_end' as const, messages }),
  /** Response de pi a un comando (get_messages, get_state, etc.). */
  response: (command: string, success: boolean, data?: unknown) =>
    ({ type: 'response' as const, command, success, data } as const),
};

// ─── Secuencias canónicas completas ────────────────────────
//
// Helper de alto nivel que arma un turno simple end-to-end. Útil para
// los tests que solo necesitan "un turno de chat terminó" como setup.
// La verificación específica la hace cada test.

/** Ejecuta, vía applyEvent, un turno simple de chat (user → assistant
 *  streaming → agent_end). Devuelve las timestamps usadas por si el
 *  test quiere volver a referenciar los mensajes. */
export function runSimpleTurn(
  apply: (e: unknown) => void,
  tabId: string,
  userText = 'hola',
  asstText = 'Hola mundo',
  userTs = 1000,
  asstTs = 2000,
): void {
  void tabId; // el routing lo maneja el caller via beginStreamForSession
  apply(ev.agent_start());
  apply(ev.turn_start());
  apply(ev.message_start(userMessage(userText, userTs)));
  apply(ev.message_end(userMessage(userText, userTs)));
  apply(ev.message_start(assistantPartial('Ho', asstTs)));
  apply(ev.message_update(assistantPartial('Hola', asstTs), 'la'));
  apply(ev.message_update(assistantPartial(asstText, asstTs), asstText.slice('Hola'.length)));
  apply(ev.message_end(assistantFinal(asstText, asstTs)));
  apply(ev.turn_end());
  apply(ev.agent_end([
    userMessage(userText, userTs),
    assistantFinal(asstText, asstTs),
  ]));
}