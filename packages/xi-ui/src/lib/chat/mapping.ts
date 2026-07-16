/**
 * mapping.ts — Convierte AgentMessages de pi a ChatMessages de xi.
 *
 * Única frontera entre el shape de pi y el de xi. Si pi cambia el
 * shape de un mensaje, solo se toca este archivo.
 *
 * Decisiones de diseño:
 * - D4: IDs por timestamp (estable durante todo el ciclo de vida del
 *   message en pi). `messageId(role, timestamp) = \`${role}_${timestamp}\``.
 *   Determinístico: mismo input → mismo ID.
 * - D8: ToolCallPart se mapea con `state: 'pending'`. El state se
 *   actualiza después con tool_execution_* events (no acá).
 *
 * Pi AgentMessage shapes (de @earendil-works/pi-ai y pi-coding-agent):
 *   UserMessage:              { role: 'user', content: string | (Text|Image)[], timestamp }
 *   AssistantMessage:         { role: 'assistant', content: (Text|Thinking|ToolCall)[], api, provider, model, usage, stopReason, errorMessage?, timestamp }
 *   ToolResultMessage:        { role: 'toolResult', toolCallId, toolName, content: (Text|Image)[], details?, isError, timestamp }
 *   BashExecutionMessage:     { role: 'bashExecution', command, output, exitCode, cancelled, truncated, timestamp }
 *   CompactionSummaryMessage: { role: 'compactionSummary', summary, tokensBefore, timestamp }
 *   BranchSummaryMessage:     { role: 'branchSummary', summary, fromId, timestamp }   → ignorado
 *   CustomMessage:            { role: 'custom', ... }                                  → ignorado
 */

/** Contador local para IDs estables cuando pi no provee timestamp. */
let idCounter = 0;

import type {
  ChatMessage,
  MessageId,
  MessageRole,
  Part,
  AssistantMetadata,
  TokenUsage,
  ToolCallPart,
  ToolState,
  ToolGroupSummary,
} from './types.ts';

// ─── ID ───────────────────────────────────────────────────

/** Genera un ID estable basado en role + timestamp (D4).
 *
 *  El timestamp de pi es estable durante todo el ciclo de vida del
 *  message (message_start → message_update* → message_end → agent_end).
 *  Mismo AgentMessage → mismo ChatMessage.id. */
export function messageId(role: string, timestamp: number): MessageId {
  return `${role}_${timestamp}`;
}

// ─── Punto de entrada ─────────────────────────────────────

/** Mapea un AgentMessage de pi a un ChatMessage de xi.
 *
 *  Devuelve `null` para roles desconocidos o ignorados
 *  (branchSummary, custom, notification). El caller decide qué
 *  hacer con null (típicamente: filtrar). */
export function mapAgentMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as Record<string, unknown>;
  const role = msg.role as string | undefined;
  if (!role) return null;

  const timestamp = typeof msg.timestamp === 'number' ? msg.timestamp : idCounter++;

  switch (role) {
    case 'user':              return mapUserMessage(msg, timestamp);
    case 'assistant':         return mapAssistantMessage(msg, timestamp);
    case 'toolResult':        return mapToolResultMessage(msg, timestamp);
    case 'bashExecution':     return mapBashExecutionMessage(msg, timestamp);
    case 'compactionSummary': return mapCompactionMessage(msg, timestamp);
    // Roles que xi ignora por ahora.
    case 'branchSummary':
    case 'custom':
    case 'notification':
      return null;
    default:
      return null;
  }
}

// ─── Per-role mappers ─────────────────────────────────────

type RawMsg = Record<string, unknown>;

function mapUserMessage(msg: RawMsg, timestamp: number): ChatMessage {
  return {
    id: messageId('user', timestamp),
    role: 'user',
    parts: [{ type: 'text', text: stringifyContent(msg.content) }],
    timestamp,
  };
}

function mapAssistantMessage(msg: RawMsg, timestamp: number): ChatMessage {
  const blocks = Array.isArray(msg.content) ? msg.content : [];
  const parts: Part[] = [];
  for (const block of blocks) {
    const part = mapContentBlock(block);
    if (part) parts.push(part);
  }

  const metadata = buildAssistantMetadata(msg);

  return {
    id: messageId('assistant', timestamp),
    role: 'assistant',
    parts,
    timestamp,
    metadata,
  };
}

function mapToolResultMessage(msg: RawMsg, timestamp: number): ChatMessage {
  const toolCallId = typeof msg.toolCallId === 'string' ? msg.toolCallId : '';
  const toolName = typeof msg.toolName === 'string' ? msg.toolName : 'unknown';
  const isError = msg.isError === true;

  return {
    id: messageId('toolResult', timestamp),
    role: 'toolResult',
    parts: [{
      type: 'toolResult',
      toolCallId,
      toolName,
      result: { output: stringifyContent(msg.content) },
      isError,
    }],
    timestamp,
  };
}

/** BashExecutionMessage se mapea como toolResult con toolName='bash'. */
function mapBashExecutionMessage(msg: RawMsg, timestamp: number): ChatMessage {
  const output = typeof msg.output === 'string' ? msg.output : '';
  const exitCode = typeof msg.exitCode === 'number' ? msg.exitCode : 0;
  const command = typeof msg.command === 'string' ? msg.command : '';

  return {
    id: messageId('toolResult', timestamp),
    role: 'toolResult',
    parts: [{
      type: 'toolResult',
      // BashExecutionMessage no tiene toolCallId propio. Usamos el
      // timestamp para que el render no crashee. Si un tool call de
      // bash lo referencia, no hay match — pero bash se ejecuta con
      // `!` command, no como tool call, así que no hay ToolCallPart
      // que matchear.
      toolCallId: `bash_${timestamp}`,
      toolName: 'bash',
      result: { output: command ? `$ ${command}\n${output}` : output },
      isError: exitCode !== 0,
    }],
    timestamp,
  };
}

function mapCompactionMessage(msg: RawMsg, timestamp: number): ChatMessage {
  return {
    id: messageId('compaction', timestamp),
    role: 'compaction',
    parts: [{
      type: 'compaction',
      summary: typeof msg.summary === 'string' ? msg.summary : '',
      tokensBefore: typeof msg.tokensBefore === 'number' ? msg.tokensBefore : 0,
    }],
    timestamp,
  };
}

// ─── Content blocks ───────────────────────────────────────

/** Mapea un block del `content` de un AssistantMessage a un Part. */
function mapContentBlock(block: unknown): Part | null {
  if (!block || typeof block !== 'object') return null;
  const b = block as Record<string, unknown>;
  switch (b.type) {
    case 'text':
      return mapTextBlock(b);
    case 'thinking':
      return mapThinkingBlock(b);
    case 'toolCall':
      return mapToolCallBlock(b);
    default:
      return null;
  }
}

function mapTextBlock(b: RawMsg): Part {
  return {
    type: 'text',
    text: typeof b.text === 'string' ? b.text : '',
  };
}

function mapThinkingBlock(b: RawMsg): Part {
  // Pi usa `thinking` como campo; algunos legacy usan `content`.
  const text = typeof b.thinking === 'string'
    ? b.thinking
    : typeof b.content === 'string' ? b.content : '';
  return { type: 'thinking', text };
}

function mapToolCallBlock(b: RawMsg): Part {
  const id = typeof b.id === 'string' ? b.id : '';
  const name = typeof b.name === 'string' ? b.name : 'unknown';
  const args = (b.arguments && typeof b.arguments === 'object')
    ? b.arguments as Record<string, unknown>
    : {};

  const part: ToolCallPart = {
    type: 'toolCall',
    toolCallId: id,
    name,
    arguments: args,
    state: 'pending' as ToolState,
  };
  return part;
}

// ─── Metadata ─────────────────────────────────────────────

/** Construye AssistantMetadata solo si el mensaje tiene `usage`.
 *  Los parciales durante streaming no tienen usage → metadata undefined. */
function buildAssistantMetadata(msg: RawMsg): AssistantMetadata | undefined {
  if (!msg.usage || typeof msg.usage !== 'object') return undefined;

  const model = typeof msg.model === 'string' ? msg.model : 'unknown';
  const provider = typeof msg.provider === 'string' ? msg.provider : 'unknown';
  const usage = mapUsage(msg.usage as RawMsg);
  const stopReason = mapStopReason(msg.stopReason);

  const metadata: AssistantMetadata = {
    model,
    provider,
    usage,
    stopReason,
  };
  if (typeof msg.errorMessage === 'string') {
    metadata.errorMessage = msg.errorMessage;
  }
  return metadata;
}

function mapUsage(raw: RawMsg): TokenUsage {
  return {
    input: numOr(raw.input, 0),
    output: numOr(raw.output, 0),
    cacheRead: numOr(raw.cacheRead, 0),
    cacheWrite: numOr(raw.cacheWrite, 0),
    // pi usa `totalTokens`; fallback a `total` por las dudas.
    total: numOr(raw.totalTokens, numOr(raw.total, 0)),
  };
}

function mapStopReason(raw: unknown): AssistantMetadata['stopReason'] {
  switch (raw) {
    case 'stop':    return 'stop';
    case 'length':  return 'length';
    case 'toolUse': return 'toolUse';
    case 'error':   return 'error';
    case 'aborted': return 'aborted';
    default:        return 'stop';
  }
}

// ─── Helpers ──────────────────────────────────────────────

/** Convierte el `content` de un AgentMessage a string.
 *
 *  - string → tal cual.
 *  - array de blocks → concatena los `TextContent.text` con `\n\n`.
 *  - cualquier otra cosa → ''. */
export function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as Record<string, unknown>;
      if (typeof b.text === 'string') parts.push(b.text);
    }
  }
  return parts.join('\n\n');
}

function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// ─── Util ─────────────────────────────────────────────────

/** Concatena los TextPart.text de un ChatMessage. Usado por
 *  ChatBubble.update() para extraer el delta del StreamBuffer (D6). */
export function extractText(msg: ChatMessage): string {
  let out = '';
  for (const part of msg.parts) {
    if (part.type === 'text') out += part.text;
  }
  return out;
}

// ─── Tool call grouping para chips UI ─────────────────────

/** Mapeo de tool name a verbo en español para los chips. */
const TOOL_ACTION_LABELS: Record<string, string> = {
  bash: 'Ejecutó',
  read: 'Leyó',
  edit: 'Editó',
  write: 'Escribió',
  grep: 'Buscó',
  find: 'Buscó',
  ls: 'Listó',
  web_search: 'Buscó en la web',
  web_search_exa: 'Buscó en la web',
  get_code_context_exa: 'Buscó código',
  crawling_exa: 'Extrayó página',
  web_search_advanced_exa: 'Buscó en la web',
  ask: 'Preguntó',
};

/** Mapeo inverso: verbo → forma pasiva (Se + 3ra persona). */
const PASSIVE_FORM: Record<string, string> = {
  Ejecutó: 'Se ejecutó',
  Leyó: 'Se leyó',
  Editó: 'Se editó',
  Escribió: 'Se escribió',
  Buscó: 'Se buscó',
  Listó: 'Se listó',
  'Extrayó página': 'Se extrajo página',
  'Buscó en la web': 'Se buscó en la web',
  'Buscó código': 'Se buscó código',
  Preguntó: 'Se preguntó',
};

/** Convierte una acción a forma pasiva para el summary. */
export function passiveLabel(action: string): string {
  return PASSIVE_FORM[action] ?? action;
}

/** Obtiene el verbo en español para un tool name.
 *  Si no está mapeado, usa el nombre raw. */
export function actionName(toolName: string): string {
  return TOOL_ACTION_LABELS[toolName] ?? toolName;
}

/** Agrupa ToolCallParts por acción para mostrar un resumen tipo
 *  "Editó 2 archivos, leyó 3 archivos". Los tools con estado
 *  'failed' se agrupan aparte como "Error al ${name}".
 *
 *  Ej: parts = [edit(file1), edit(file2), read(file3)]
 *    → [{action: "Editó", count: 2, tools: [...]},
 *        {action: "Leyó", count: 1, tools: [...]}] */
export function groupToolCalls(parts: ToolCallPart[]): ToolGroupSummary[] {
  const groups = new Map<string, ToolGroupSummary>();
  for (const tc of parts) {
    const action = tc.state === 'failed'
      ? `Error al ${tc.name}`
      : actionName(tc.name);
    const existing = groups.get(action);
    if (existing) {
      existing.count++;
      existing.tools.push(tc);
    } else {
      groups.set(action, { action, count: 1, tools: [tc] });
    }
  }
  return Array.from(groups.values());
}

/** Helper de tipos: retorna el role de un Part. Útil para switch
 *  exhaustivo en el render. */
export function partRole(part: Part): MessageRole {
  switch (part.type) {
    case 'text':         return 'user';       // text puede aparecer en user o assistant
    case 'thinking':     return 'assistant';
    case 'toolCall':     return 'assistant';
    case 'toolResult':   return 'toolResult';
    case 'compaction':   return 'compaction';
  }
}
