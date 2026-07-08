/**
 * types.ts — Modelo de datos del chat de xi.
 *
 * Tipos puros, sin imports de Tauri, DOM, ni signals. La única frontera
 * entre pi (que usa sus propios AgentMessage) y xi (que usa ChatMessage
 * con Parts) vive en `mapping.ts`. Este archivo define la representación
 * interna de xi.
 *
 * Decisiones de diseño (ver `.develop/02-design/chat-architecture-v2.md`):
 * - D3: Parts model híbrido — mismo shape para todos los roles,
 *   diferente contenido de parts según el rol.
 * - D4: IDs por timestamp (estable durante todo el ciclo de vida del
 *   message en pi).
 * - D8: ToolCallPart trackea SOLO state (string). El result text vive
 *   en un ToolResultPart separado, fiel a pi.
 */

// ─── IDs ──────────────────────────────────────────────────

/** ID de un ChatMessage. Formato: `${role}_${timestamp}` (D4). */
export type MessageId = string;

/** ID de un tab/sesión de xi. */
export type SessionId = string;

/** ID de un tool call, asignado por pi. Estable entre toolcall_start,
 *  tool_execution_*, y el ToolResultMessage. */
export type ToolCallId = string;

// ─── Parts ────────────────────────────────────────────────

/** Unión discriminada de las partes de un mensaje. */
export type Part =
  | TextPart
  | ThinkingPart
  | ToolCallPart
  | ToolResultPart
  | CompactionPart;

/** Bloque de texto (assistant o user). */
export interface TextPart {
  type: 'text';
  text: string;
}

/** Bloque de thinking/rasoning del assistant. */
export interface ThinkingPart {
  type: 'thinking';
  text: string;
}

/** Tool call dentro de un assistant message.
 *
 *  Trackea el `state` (string) para UI. El `result` se mergea desde
 *  el mensaje toolResult correspondiente a través del reducer, para
 *  que los chips puedan mostrar el resultado inline (como Claude Desktop).
 *  Originalmente el result text vivía en un `ToolResultPart` separado
 *  (D8), pero ahora se duplica al ToolCallPart para facilitar la UI. */
export interface ToolCallPart {
  type: 'toolCall';
  toolCallId: ToolCallId;
  name: string;
  arguments: Record<string, unknown>;
  state: ToolState;
  /** Resultado mergeado desde el toolResult message. Undefined hasta
   *  que el reducer lo procesa. */
  result?: { output: string; isError: boolean };
}

/** State machine del ToolCallPart (D8). */
export type ToolState = 'pending' | 'running' | 'completed' | 'failed';

/** Resumen agrupado de tool calls para chips UI.
 *  Ej: "Editó 2 archivos, leyó 3 archivos" */
export interface ToolGroupSummary {
  /** Verbo en español: "Editó", "Leyó", "Ejecutó", "Error al editar" */
  action: string;
  /** Cantidad de tool calls en este grupo */
  count: number;
  /** Las tool calls agrupadas */
  tools: ToolCallPart[];
}

/** Tool result como message separado (role='toolResult').
 *
 *  Fiel a pi: `ToolResultMessage` es un message aparte con
 *  `toolCallId`, `toolName`, `content`, `isError`. */
export interface ToolResultPart {
  type: 'toolResult';
  toolCallId: ToolCallId;
  toolName: string;
  result: { output: string };
  isError: boolean;
}

/** Compaction: pi comprimió N tokens de historial en un resumen. */
export interface CompactionPart {
  type: 'compaction';
  summary: string;
  tokensBefore: number;
}

// ─── Messages ─────────────────────────────────────────────

/** Rol de un ChatMessage. Alineado con los roles de pi. */
export type MessageRole = 'user' | 'assistant' | 'toolResult' | 'compaction';

/** Mensaje en xi.
 *
 *  Híbrido (D3): mismo shape para todos los roles, diferente contenido
 *  de parts según el rol:
 *  - user:       parts = [TextPart]
 *  - assistant:  parts = (TextPart | ThinkingPart | ToolCallPart)[]
 *  - toolResult: parts = [ToolResultPart]
 *  - compaction: parts = [CompactionPart] */
export interface ChatMessage {
  id: MessageId;
  role: MessageRole;
  parts: Part[];
  timestamp: number;
  /** Metadata del assistant. Solo en role='assistant'. */
  metadata?: AssistantMetadata;
  /** Transient: true si se está streameando. No persistido. */
  isStreaming?: boolean;
}

/** Metadata de un assistant message. Populada solo si el mensaje de
 *  pi tiene `usage` (los parciales durante streaming no lo tienen). */
export interface AssistantMetadata {
  model: string;
  provider: string;
  usage: TokenUsage;
  stopReason: StopReason;
  errorMessage?: string;
}

/** Subset de Usage de pi. `total` = `totalTokens` de pi. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export type StopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';

// ─── State ────────────────────────────────────────────────

/** Estado del chat de una sesión/tab. */
export interface ChatState {
  session: ChatSession | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  /** ID del message que se está streameando. null si no hay. */
  streamingMessageId: MessageId | null;
}

export interface ChatSession {
  id: SessionId;
  file: string | null;
  name: string | null;
  messageCount: number;
}
