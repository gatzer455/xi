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

import { appState, type ChatMessage, type ToolCall, type PiModel } from '../state.ts';
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

  // Solo `get_state` devuelve un `data` con campos que nos interesan.
  // Las otras respuestas son confirmaciones sin payload útil.
  if (response.command !== 'get_state' || !response.data) return;

  const data = response.data as Record<string, unknown>;
  if (data.model) appState.currentModel.value = data.model as PiModel;
  if (data.thinkingLevel) appState.thinkingLevel.value = data.thinkingLevel as string;
  if (data.sessionFile) {
    appState.session.value = {
      id: (data.sessionId as string) ?? '',
      name: data.sessionName as string | undefined,
      file: data.sessionFile as string,
      messageCount: (data.messageCount as number) ?? 0,
    };
  }
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
