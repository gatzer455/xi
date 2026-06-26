/**
 * state-sync.ts — Aplica eventos de pi al estado de la app.
 *
 * Nueva arquitectura (chat-architecture-v2):
 *  - Los mensajes viven en `ChatStore`s per-tab (lib/chat/stores.ts).
 *  - Este módulo MAPEA PiEvents → ChatEvents y los DISPATCHA al store
 *    correcto. No acumula deltas, no muta messages a mano: el reducer
 *    puro (lib/chat/reducer.ts) hace el trabajo.
 *  - Routing multi-tab via `streamingSessionId`: el tab que inició el
 *    stream recibe los eventos de streaming, sin importar cuál tab
 *    esté activa cuando lleguen (D7). Se "reclama" al enviar el prompt
 *    (beginStreamForSession) para ganar la carrera contra el cambio
 *    de tab, y se limpia en agent_end / terminated.
 *
 *  Quedan acá las signals GLOBALES que no son por-tab:
 *  - appState.isStreaming    → "pi está streameando (alguna tab)".
 *                              Lo usa el InputBar para el botón Stop.
 *  - appState.currentModel / thinkingLevel / session / availableModels
 *    → vienen de responses (get_state, get_available_models, set_model).
 *
 *  Conversación (mensajes) → ChatStore. Globales (modelo, sesión
 *  activa para metadatos) → appState. El ChatPage lee messages del
 *  store del activeTab e isStreaming del store del activeTab para el
 *  footer/indicador.
 */

import { appState, type PiModel, type ThinkingLevel, type Session } from '../state.ts';
import { addEntry } from '../debug-panel.ts';
import { getStore } from '../chat/stores.ts';
import { mapAgentMessage } from '../chat/mapping.ts';
import type { ChatEvent } from '../chat/reducer.ts';
import type { ChatMessage } from '../chat/types.ts';
import type {
  PiEvent,
  PiResponseEvent,
  PiMessageStartEvent,
  PiMessageUpdateEvent,
  PiMessageEndEvent,
  PiToolExecutionEvent,
  PiAgentEvent,
} from './event-parser.ts';

// ─── Routing multi-tab ────────────────────────────────────

/** Tab que está streameando ahora. Se reclama en `beginStreamForSession`
 *  (al enviar el prompt) y se limpia en agent_end / terminated. null
 *  cuando no hay stream activo. Si es null y llega un evento de
 *  streaming (ej. compaction-triggered continuation), se enruta al
 *  activeTabId como fallback. */
let streamingSessionId: string | null = null;

/** Reclama el routing del próximo stream para `sessionId`. Llamar ANTES
 *  de `sendPrompt` para ganar la carrera contra un cambio de tab que el
 *  usuario pueda hacer antes de que llegue `agent_start`. */
export function beginStreamForSession(sessionId: string): void {
  streamingSessionId = sessionId;
  appState.isStreaming.value = true;
}

/** Limpia el routing del stream (abort, error de envío, terminated). */
export function endStream(): void {
  streamingSessionId = null;
  appState.isStreaming.value = false;
}

// ─── Punto de entrada ─────────────────────────────────────

export function applyEvent(event: PiEvent): void {
  addEntry('in', JSON.stringify(event, null, 2));

  if (event.type === 'response') {
    handleResponse(event as PiResponseEvent);
    return;
  }

  routeStreamEvent(event);
}

// ─── Responses (rutean al activeTab + actualizan globals) ─

function handleResponse(response: PiResponseEvent): void {
  if (!response.success) {
    addEntry('system', `[pi error] ${response.error ?? 'unknown error'}`);
    return;
  }

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
      if (response.data) appState.currentModel.value = response.data as PiModel;
      return;
    case 'set_thinking_level':
      return;
    default:
      return;
  }
}

function applyGetState(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  if (data.model) appState.currentModel.value = data.model as PiModel;
  if (data.thinkingLevel) appState.thinkingLevel.value = data.thinkingLevel as ThinkingLevel;
  if (data.sessionFile) {
    const session: Session = {
      id: (data.sessionId as string) ?? '',
      name: data.sessionName as string | undefined,
      file: data.sessionFile as string,
      messageCount: (data.messageCount as number) ?? 0,
    };
    appState.session.value = session;
    // Guardamos metadatos de sesión en el store del activeTab.
    dispatchToActive({ type: 'response_get_state', session: {
      id: session.id,
      file: session.file ?? null,
      name: session.name ?? null,
      messageCount: session.messageCount,
    }});
  }
}

function applyGetMessages(data: { messages?: unknown[] } | undefined): void {
  if (!data || !Array.isArray(data.messages)) return;
  const messages: ChatMessage[] = [];
  for (const raw of data.messages) {
    const m = mapAgentMessage(raw);
    if (m) messages.push(m);
  }
  dispatchToActive({ type: 'response_get_messages', messages });
}

function applyAvailableModels(data: { models?: unknown[] } | undefined): void {
  if (!data || !Array.isArray(data.models)) {
    appState.availableModels.value = [];
    return;
  }
  const valid: PiModel[] = [];
  for (const m of data.models) {
    if (isPiModel(m)) valid.push(m);
  }
  appState.availableModels.value = valid;
}

function isPiModel(value: unknown): value is PiModel {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return typeof m.provider === 'string' && typeof m.id === 'string';
}

// ─── Streaming / lifecycle events ─────────────────────────

function routeStreamEvent(event: PiEvent): void {
  // agent_start reclama el stream si nadie lo reclamó (continuación
  // por compaction, steer, etc.). Si ya fue reclamado por
  // beginStreamForSession, respetamos ese claim.
  if (event.type === 'agent_start' && streamingSessionId === null) {
    streamingSessionId = appState.activeTabId.value;
  }
  if (event.type === 'agent_start') {
    appState.isStreaming.value = true;
  }

  const targetId = streamingSessionId ?? appState.activeTabId.value;
  if (!targetId) {
    addEntry('system', `[state-sync] event sin target (no active tab): ${event.type}`);
    return;
  }

  const chatEvents = mapStreamEvent(event);
  if (chatEvents.length === 0) return;

  const store = getStore(targetId);
  for (const ce of chatEvents) store.dispatch(ce);

  // agent_end limpia el routing y el flag global.
  if (event.type === 'agent_end') {
    streamingSessionId = null;
    appState.isStreaming.value = false;
  }
}

/** Convierte un PiEvent de streaming/lifecycle en 0..N ChatEvents. */
function mapStreamEvent(event: PiEvent): ChatEvent[] {
  switch (event.type) {
    case 'agent_start':          return [{ type: 'agent_start' }];
    case 'turn_start':
    case 'turn_end':
      // Marcadores de turno; el reducer no los necesita.
      return [];
    case 'message_start':        return mapMessageEvent(event as PiMessageStartEvent, 'message_start');
    case 'message_update':       return mapMessageEvent(event as PiMessageUpdateEvent, 'message_update');
    case 'message_end':          return mapMessageEvent(event as PiMessageEndEvent, 'message_end');
    case 'tool_execution_start': {
      const e = event as PiToolExecutionEvent;
      return [{ type: 'tool_execution_start', toolCallId: e.toolCallId }];
    }
    case 'tool_execution_end': {
      const e = event as PiToolExecutionEvent;
      return [{ type: 'tool_execution_end', toolCallId: e.toolCallId, isError: e.isError === true }];
    }
    case 'agent_end': {
      const e = event as PiAgentEvent;
      const raws = Array.isArray(e.messages) ? e.messages : [];
      const messages: ChatMessage[] = [];
      for (const raw of raws) {
        const m = mapAgentMessage(raw);
        if (m) messages.push(m);
      }
      return [{ type: 'agent_end', messages }];
    }
    default:
      // Eventos que no nos interesan (auto_retry_*, compaction markers
      // sueltos, etc.). No warning para no saturar el log.
      return [];
  }
}

/** Mapea un message_start/update/end a su ChatEvent. El `message`
 *  viene con el AgentMessage completo (parcial o final). Lo pasamos
 *  por mapAgentMessage y, si es válido, emitimos el ChatEvent. */
function mapMessageEvent(
  event: PiMessageStartEvent | PiMessageUpdateEvent | PiMessageEndEvent,
  kind: 'message_start' | 'message_update' | 'message_end',
): ChatEvent[] {
  const msg = mapAgentMessage((event as { message?: unknown }).message);
  if (!msg) return [];
  if (kind === 'message_start') return [{ type: 'message_start', message: msg }];
  if (kind === 'message_update') return [{ type: 'message_update', message: msg }];
  return [{ type: 'message_end', message: msg }];
}

// ─── Helpers ──────────────────────────────────────────────

/** Despacha un ChatEvent al store del activeTab. Si no hay activeTab,
 *  loguea y descarta. */
function dispatchToActive(event: ChatEvent): void {
  const id = appState.activeTabId.value;
  if (!id) {
    addEntry('system', `[state-sync] response sin active tab: ${event.type}`);
    return;
  }
  getStore(id).dispatch(event);
}