/**
 * event-parser.ts — Convierte líneas JSONL de pi en eventos tipados.
 *
 * La función parsePiEvent es pura. No conoce Tauri, ni el DOM, ni el state
 * de la app. Esa separación existe por dos razones. Primero, el parser se
 * puede probar en aislamiento, sin levantar la app. Segundo, si mañana el
 * transporte cambia (de Tauri events a WebSocket, por ejemplo), este archivo
 * no se toca: solo cambia el módulo que invoca parsePiEvent.
 *
 * El error se modela según Parse, don't validate. La función devuelve el
 * evento parseado cuando todo salió bien, y null cuando el JSON estaba
 * malformado o le faltaba el campo `type`. null es la única señal de error.
 * El caller decide qué hacer con un parse fallido.
 */

// Tipos de eventos que pi puede emitir. La unión cubre los tipos conocidos
// en la versión actual del protocolo RPC. El `(string & {})` al final permite
// que pi agregue tipos nuevos sin romper la compilación de TypeScript: cualquier
// string es asignable, pero los literales conocidos siguen autocompletándose.
export type PiEventType =
  | 'response'
  | 'message_update'
  | 'tool_execution_start'
  | 'tool_execution_end'
  | 'agent_start'
  | 'agent_end'
  | 'turn_start'
  | 'turn_end'
  | (string & {});

export type AssistantMessageEventType =
  | 'text_start'
  | 'text_delta'
  | 'text_end'
  | 'thinking_start'
  | 'thinking_delta'
  | 'thinking_end'
  | 'toolcall_start'
  | 'toolcall_delta'
  | 'toolcall_end'
  | (string & {});

export interface AssistantMessageEvent {
  type: AssistantMessageEventType;
  contentIndex?: number;
  delta?: string;
  content?: string;
  partial?: unknown;
}

export interface PiResponseEvent {
  type: 'response';
  id?: string;
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface PiMessageUpdateEvent {
  type: 'message_update';
  message?: unknown;
  assistantMessageEvent?: AssistantMessageEvent;
}

export interface PiToolExecutionEvent {
  type: 'tool_execution_start' | 'tool_execution_end';
  toolCallId: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
}

export interface PiAgentEvent {
  type: 'agent_start' | 'agent_end' | 'turn_start' | 'turn_end';
  messages?: unknown[];
}

export type PiEvent =
  | PiResponseEvent
  | PiMessageUpdateEvent
  | PiToolExecutionEvent
  | PiAgentEvent
  | { type: PiEventType; [key: string]: unknown };

/**
 * Parsea una línea JSONL de pi.
 *
 * Devuelve el evento tipado cuando la línea es un objeto JSON con un campo
 * `type` de tipo string. Devuelve `null` en cualquier otro caso: JSON
 * inválido, no es un objeto, o le falta `type`. La función no lanza
 * excepciones: el caller siempre recibe un valor (evento o null) y puede
 * ramificar sin try/catch.
 */
export function parsePiEvent(raw: string): PiEvent | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (typeof parsed.type !== 'string') return null;
    return parsed as PiEvent;
  } catch {
    return null;
  }
}
