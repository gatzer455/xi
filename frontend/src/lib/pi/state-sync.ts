/**
 * state-sync.ts — Aplica eventos de pi al estado de la app.
 *
 * Es el único módulo del paquete `pi/` que muta `appState`. Esa exclusividad
 * existe para que un cambio en el formato de un evento solo toque dos archivos
 * en tándem: `event-parser.ts` (cómo se interpreta el JSON) y este (qué hace
 * el estado con esa interpretación). El resto de la app no sabe de eventos.
 *
 * La función pública es `applyEvent`. Recibe un `PiEvent` ya parseado y
 * dispara el switch que delega a los handlers por tipo. Cada switch tiene
 * un `default` que loguea un warning. Eso es deliberado: si pi agrega un
 * tipo de evento nuevo, la app sigue funcionando y el panel de debug lo
 * deja ver. Un `throw` aquí sería peor: detendría el listener y perderíamos
 * todos los eventos siguientes.
 */

import { appState, type ChatMessage, type ToolCall, type PiModel, type ThinkingBlock, type ThinkingLevel } from '../state.ts';
import { addEntry } from '../debug-panel.ts';
import type {
  PiEvent,
  PiResponseEvent,
  PiMessageUpdateEvent,
  PiToolExecutionEvent,
  AssistantMessageEvent,
} from './event-parser.ts';

// El assistant message que se está acumulando. Persiste entre deltas: el
// primer `text_delta` lo crea, los siguientes lo mutan in-place, y un
// `agent_end` lo cierra y lo limpia.
let currentAssistantMessage: ChatMessage | null = null;

export function applyEvent(event: PiEvent): void {
  addEntry('in', JSON.stringify(event, null, 2));

  switch (event.type) {
    case 'response':
      handleResponse(event as PiResponseEvent);
      return;
    case 'message_update':
      handleMessageUpdate(event as PiMessageUpdateEvent);
      return;
    case 'tool_execution_start':
    case 'tool_execution_end':
      handleToolExecution(event as PiToolExecutionEvent);
      return;
    case 'agent_start':
    case 'turn_start':
      appState.isStreaming.value = true;
      return;
    case 'agent_end':
    case 'turn_end':
      handleAgentEnd();
      return;
    default:
      addEntry('system', `[state-sync] unknown event type: ${(event as { type: string }).type}`);
  }
}

function handleResponse(response: PiResponseEvent): void {
  if (!response.success) {
    addEntry('system', `[pi error] ${response.error ?? 'unknown error'}`);
    return;
  }

  // Distinguimos commands por su `data` shape. Hoy nos importan:
  // `get_state` (carga estado), `get_messages` (carga historial), y
  // `get_available_models` (carga la lista de modelos para el dropdown
  // de settings). Las otras respuestas son confirmaciones sin payload.
  switch (response.command) {
    case 'get_state':
      applyGetState(response.data as Record<string, unknown> | undefined);
      return;
    case 'get_messages':
      applyGetMessages(response.data as { messages?: unknown[] } | undefined);
      return;
    case 'get_available_models':
      applyAvailableModels(response.data as { models?: unknown[] } | undefined);
      return;
    case 'set_model':
      // Pi responde con el modelo nuevo; refrescamos el state para que
      // currentModel quede sincronizado sin esperar al próximo get_state.
      if (response.data) {
        appState.currentModel.value = response.data as PiModel;
      }
      return;
    case 'set_thinking_level':
      // Pi responde confirmando; get_state (al cambiar de sesión o al
      // iniciar) traerá el nivel nuevo. No hacemos nada acá.
      return;
    default:
      // Otros commands (new_session, abort, etc.) son no-op para el state.
      return;
  }
}

/** Maneja la respuesta de `get_available_models`. Pi retorna
 *  `data.models` con un array de modelos. Si la lista está vacía
 *  (no hay providers configurados) o el shape es inválido, lo
 *  dejamos como [] — el dropdown de settings mostrará un mensaje
 *  útil. */
function applyAvailableModels(data: { models?: unknown[] } | undefined): void {
  if (!data || !Array.isArray(data.models)) {
    appState.availableModels.value = [];
    return;
  }
  // Filtramos: solo aceptamos items que parezcan un PiModel válido.
  // (Defensa contra shape inválido o parcial.)
  const valid: PiModel[] = [];
  for (const m of data.models) {
    if (isPiModel(m)) valid.push(m);
  }
  appState.availableModels.value = valid;
}

function isPiModel(value: unknown): value is PiModel {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.provider === 'string' &&
    typeof m.id === 'string'
  );
}

function applyGetState(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  if (data.model) appState.currentModel.value = data.model as PiModel;
  if (data.thinkingLevel) appState.thinkingLevel.value = data.thinkingLevel as ThinkingLevel;
  if (data.sessionFile) {
    appState.session.value = {
      id: (data.sessionId as string) ?? '',
      name: data.sessionName as string | undefined,
      file: data.sessionFile as string,
      messageCount: (data.messageCount as number) ?? 0,
    };
  }
}

/**
 * Maneja la respuesta de `get_messages`. Pi retorna `data.messages`
 * con un array de `AgentMessage` (UserMessage, AssistantMessage,
 * ToolResultMessage, BashExecutionMessage). Mapeamos cada uno a un
 * `ChatMessage` para popular `appState.messages`. Los tool results se
 * mantienen como mensajes separados (role: 'toolResult') — fiel al JSONL,
 * más simple que acoplar al tool call del assistant.
 */
function applyGetMessages(data: { messages?: unknown[] } | undefined): void {
  if (!data || !Array.isArray(data.messages)) return;

  const messages: ChatMessage[] = [];
  for (const raw of data.messages) {
    const parsed = parseAgentMessage(raw);
    if (parsed) messages.push(parsed);
  }
  appState.messages.value = messages;
}

/**
 * Parsea un `AgentMessage` de pi y lo convierte a `ChatMessage`. Acepta
 * los 4 tipos conocidos. Si el shape no matchea ninguno, devuelve `null`
 * y loguea un warning — preferiría fallar visible que tragarmelo.
 */
function parseAgentMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as Record<string, unknown>;
  const role = msg.role as string | undefined;
  const timestamp = (msg.timestamp as number) ?? Date.now();

  switch (role) {
    case 'user':
      return parseUserMessage(msg, timestamp);
    case 'assistant':
      return parseAssistantMessage(msg, timestamp);
    case 'toolResult':
      return parseToolResultMessage(msg, timestamp);
    case 'bashExecution':
      // BashExecutionMessage se mapea como toolResult con toolName='bash'.
      return parseBashExecutionMessage(msg, timestamp);
    default:
      addEntry('system', `[state-sync] unknown AgentMessage.role: ${role}`);
      return null;
  }
}

function parseUserMessage(msg: Record<string, unknown>, timestamp: number): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: stringifyContent(msg.content),
    timestamp,
  };
}

function parseAssistantMessage(msg: Record<string, unknown>, timestamp: number): ChatMessage {
  const blocks = Array.isArray(msg.content) ? (msg.content as unknown[]) : [];
  const textParts: string[] = [];
  const thinking: ThinkingBlock[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    switch (b.type) {
      case 'text':
        if (typeof b.text === 'string') textParts.push(b.text);
        break;
      case 'thinking':
        if (typeof b.thinking === 'string') thinking.push({ content: b.thinking });
        break;
      case 'toolCall': {
        const id = (b.id as string) ?? crypto.randomUUID();
        const name = (b.name as string) ?? 'unknown';
        const args = (b.arguments as Record<string, unknown>) ?? {};
        toolCalls.push({ id, name, arguments: args });
        break;
      }
    }
  }

  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: textParts.join('\n\n'),
    timestamp,
    thinking: thinking.length > 0 ? thinking : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function parseToolResultMessage(msg: Record<string, unknown>, timestamp: number): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'toolResult',
    content: stringifyContent(msg.content),
    timestamp,
    toolResult: {
      toolName: (msg.toolName as string) ?? 'unknown',
      isError: msg.isError === true,
    },
  };
}

function parseBashExecutionMessage(msg: Record<string, unknown>, timestamp: number): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'toolResult',
    content: typeof msg.output === 'string' ? msg.output : '',
    timestamp,
    toolResult: {
      toolName: 'bash',
      isError: msg.exitCode !== 0,
    },
  };
}

/**
 * Convierte el `content` de un AgentMessage a string. El content puede
 * ser un string (UserMessage) o un array de bloques (AssistantMessage,
 * ToolResultMessage). En el caso array, concatenamos los bloques de tipo
 * `text` con `\n\n`.
 */
function stringifyContent(content: unknown): string {
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

function handleMessageUpdate(update: PiMessageUpdateEvent): void {
  const delta = update.assistantMessageEvent;
  if (!delta) return;
  applyAssistantEvent(delta);
}

function applyAssistantEvent(event: AssistantMessageEvent): void {
  switch (event.type) {
    case 'text_delta':
      appendText(event.delta ?? '');
      return;
    case 'text_start':
    case 'text_end':
      // pi emite estos marcadores para señalar el inicio/fin de un bloque
      // de texto dentro del assistant message. Hoy no los necesitamos para
      // renderizar, pero los aceptamos sin warning para no saturar el log.
      return;
    case 'thinking_delta':
      appendThinking(event.delta ?? '');
      return;
    case 'thinking_start':
      ensureThinkingArray();
      return;
    case 'thinking_end':
      return;
    case 'toolcall_delta':
      // Los tool calls se persisten por `tool_execution_*`, no por delta.
      // El delta de argumentos lo descartamos por ahora.
      return;
    case 'toolcall_start':
    case 'toolcall_end':
      return;
    default:
      addEntry('system', `[state-sync] unknown assistantMessageEvent.type: ${event.type}`);
  }
}

function handleToolExecution(tool: PiToolExecutionEvent): void {
  if (!currentAssistantMessage) return;

  if (!currentAssistantMessage.toolCalls) {
    currentAssistantMessage.toolCalls = [];
  }

  if (tool.type === 'tool_execution_start') {
    currentAssistantMessage.toolCalls.push({
      id: tool.toolCallId,
      name: tool.toolName,
      arguments: (tool.args as Record<string, unknown>) ?? {},
    });
  } else {
    // tool_execution_end
    const tc = currentAssistantMessage.toolCalls.find((t: ToolCall) => t.id === tool.toolCallId);
    if (tc) {
      tc.result = typeof tool.result === 'string'
        ? tool.result
        : JSON.stringify(tool.result);
      tc.isError = tool.isError;
    }
  }

  appState.messages.value = [...appState.messages.value];
}

function handleAgentEnd(): void {
  appState.isStreaming.value = false;
  if (currentAssistantMessage) {
    currentAssistantMessage.isStreaming = false;
    currentAssistantMessage = null;
  }
  appState.messages.value = [...appState.messages.value];
}

// ───────────────────────────────────────────────────────
// Helpers — todos planos, guard clauses, sin anidación > 2
// ───────────────────────────────────────────────────────

// Crea el assistant message si no existe. El primer delta lo crea; los
// siguientes lo mutan in-place. La reasignación de `appState.messages.value`
// dispara el subscribe de los componentes que renderizan el chat.
function appendText(delta: string): void {
  if (!delta) return;
  if (!currentAssistantMessage) {
    currentAssistantMessage = createAssistantMessage();
    appState.messages.value = [...appState.messages.value, currentAssistantMessage];
  }
  currentAssistantMessage.content += delta;
  appState.messages.value = [...appState.messages.value];
}

function ensureThinkingArray(): void {
  if (!currentAssistantMessage) {
    currentAssistantMessage = createAssistantMessage();
    appState.messages.value = [...appState.messages.value, currentAssistantMessage];
  }
  if (!currentAssistantMessage.thinking) {
    currentAssistantMessage.thinking = [];
  }
}

function appendThinking(delta: string): void {
  if (!delta) return;
  ensureThinkingArray();
  const thinking = currentAssistantMessage!.thinking!;
  const last = thinking[thinking.length - 1];
  if (last) {
    last.content += delta;
  } else {
    thinking.push({ content: delta });
  }
  appState.messages.value = [...appState.messages.value];
}

function createAssistantMessage(): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isStreaming: true,
  };
}
