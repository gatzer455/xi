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

import { appState, type PiModel, type ThinkingLevel, type Session, type SessionPath, type TabId, toSessionPath, toTabId } from '../state.ts';
import { addEntry } from '../debug-panel.ts';
import { getStore } from '../chat/stores.ts';
import { setKnownExtensionCommands } from './slash-commands.ts';
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
let streamingSessionId: SessionPath | TabId | string | null = null;

/** Guard contra eventos tardíos de pi (ej. message_update que llega
 *  DESPUÉS de agent_end — típicamente con usage/stats finales).
 *  Se activa en agent_end/endStream, se desactiva en agent_start
 *  y beginStreamForSession. Mientras está activo, los eventos de
 *  contenido (message_*, tool_execution_*) se descartan para
 *  no re-activar isStreaming en el store. */
let streamSettled = false;

// ── Ensamblado de mensajes en streaming (pi ≥ 0.84) ──

/** Buffer del mensaje en curso. Desde pi 0.84, `message_update` emite
 *  SOLO deltas (`assistantMessageEvent`) sin el campo acumulativo
 *  `message` — hay que ensamblar el partial entre `message_start`
 *  (inicializa el buffer) y `message_end` (autoritativo, reemplaza).
 *  Con pi < 0.84 (message presente), el buffer se reemplaza entero. */
let partialMsg: Record<string, unknown> | null = null;

/** Aplica un delta de streaming al mensaje en curso. Los bloques del
 *  content (texto, thinking, toolcall) se indexan por `contentIndex`. */
function applyMessageDelta(event: PiMessageUpdateEvent): void {
  const ev = event.assistantMessageEvent;
  if (!ev || !partialMsg) return;
  const blocks = (Array.isArray(partialMsg.content) ? partialMsg.content : []) as Array<Record<string, unknown>>;
  const i = ev.contentIndex ?? 0;
  while (blocks.length <= i) blocks.push({} as Record<string, unknown>);
  const block = blocks[i];
  switch (ev.type) {
    case 'text_start':     blocks[i] = { type: 'text', text: '' } as Record<string, unknown>; break;
    case 'text_delta':     block.text = (typeof block.text === 'string' ? block.text : '') + (ev.delta ?? ''); break;
    case 'text_end':       block.text = ev.content ?? (typeof block.text === 'string' ? block.text : ''); break;
    case 'thinking_start': blocks[i] = { type: 'thinking', thinking: '' } as Record<string, unknown>; break;
    case 'thinking_delta': block.thinking = (typeof block.thinking === 'string' ? block.thinking : '') + (ev.delta ?? ''); break;
    case 'thinking_end':   block.thinking = ev.content ?? (typeof block.thinking === 'string' ? block.thinking : ''); break;
    case 'toolcall_start': blocks[i] = { type: 'toolCall', arguments: '' } as Record<string, unknown>; break;
    case 'toolcall_delta': block.arguments = tryParseArgs((typeof block.arguments === 'string' ? block.arguments : '') + (ev.delta ?? '')); break;
    case 'toolcall_end':   blocks[i] = (ev.toolCall ?? block) as Record<string, unknown>; break;
    default: break; // tipos futuros de delta: ignorar
  }
  partialMsg.content = blocks;
}

/** Los arguments de un toolcall llegan como string JSON crudo.
 *  Los parseamos cuando el JSON está completo para que mapAgentMessage
 *  los vea como objeto (paridad con pi < 0.84). */
function tryParseArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}

// ── Throttle message_update (evita saturar el store con 100+ eventos/s) ──

/** Último message_update pendiente de procesar. Se actualiza en cada
 *  evento entrante y se procesa una vez por rAF. */
let pendingThrottledUpdate: { targetId: string } | null = null;
let throttleFrameId: number | null = null;

function flushThrottledUpdate(): void {
  throttleFrameId = null;
  if (!pendingThrottledUpdate) return;
  // Si el stream ya se cerró (agent_end procesado), descartar el
  // update pendiente para no re-activar isStreaming en el store.
  if (streamSettled) {
    pendingThrottledUpdate = null;
    return;
  }
  const { targetId } = pendingThrottledUpdate;
  pendingThrottledUpdate = null;

  if (!partialMsg) return;

  // Loggear solo el evento que realmente se procesa (nivel debug para no inundar)
  const size = JSON.stringify(partialMsg).length;
  addEntry('in', `↩ message_update size=${size}B`, 'debug');

  const msg = mapAgentMessage(partialMsg);
  if (!msg) return;
  getStore(targetId).dispatch({ type: 'message_update', message: msg });
}

/** Intervalo mínimo entre procesamientos de message_update (ms).
 *  rAF ya da ~16ms, pero con subimos a 50ms procesamos ~20/s
 *  en vez de ~60/s, suficiente para streaming fluido. */
const THROTTLE_MS = 50;
let lastProcessedTime = 0;

/** Reclama el routing del próximo stream para `sessionId`. Llamar ANTES
 *  de `sendPrompt` para ganar la carrera contra un cambio de tab que el
 *  usuario pueda hacer antes de que llegue `agent_start`. */
export function beginStreamForSession(sessionId: SessionPath | TabId | string): void {
  streamingSessionId = sessionId;
  streamSettled = false;
  appState.isStreaming.value = true;
}

/** Limpia el routing del stream (abort, error de envío, terminated).
 *  También notifica al store activo para que resetee su isStreaming$. */
export function endStream(): void {
  const targetId = streamingSessionId ?? appState.activeTabId.value;
  if (targetId) {
    try {
      getStore(targetId).dispatch({ type: 'agent_end', messages: [] });
    } catch {
      // Store puede no existir si ya se cerró el tab.
    }
  }
  streamingSessionId = null;
  streamSettled = true;
  partialMsg = null;
  pendingThrottledUpdate = null;
  if (throttleFrameId !== null) {
    cancelAnimationFrame(throttleFrameId);
    throttleFrameId = null;
  }
  appState.isStreaming.value = false;
}

// ─── Punto de entrada ─────────────────────────────────────

export function applyEvent(event: PiEvent): void {
  // Responses siempre se loguean (son pocas e importantes).
  if (event.type === 'response') {
    const size = JSON.stringify(event).length;
    const cmd = (event as PiResponseEvent).command ?? 'unknown';
    addEntry('in', `↩ response:${cmd} size=${size}B`);
    handleResponse(event as PiResponseEvent);
    return;
  }

  // message_update se loguea solo cuando se procesa (dentro del throttle).
  // Los demás eventos (agent_start, message_end, etc.) se loguean siempre.
  if (event.type !== 'message_update') {
    const size = JSON.stringify(event).length;
    addEntry('in', `↩ ${event.type} size=${size}B`);
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
    case 'get_commands': {
      const cmds = response.data as { commands?: { name: string; description?: string }[] } | undefined;
      if (cmds?.commands) setKnownExtensionCommands(cmds.commands);
      return;
    }
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
      id: toTabId((data.sessionId as string) ?? ''),
      name: data.sessionName as string | undefined,
      file: toSessionPath(data.sessionFile as string),
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
  // ── Guard: descartar eventos de contenido tardíos ──
  // Pi puede enviar message_update/agent_settled DESPUÉS de agent_end
  // (típicamente con usage/stats finales). Si los procesamos, el
  // reducer re-activa isStreaming y queda congelado en "Trabajando...".
  // Solo agent_start puede desbloquear el guard (nuevo stream).
  if (event.type === 'agent_start') {
    streamSettled = false;
  }
  if (streamSettled) {
    // Permitir solo responses (vienen por handleResponse, no llegan acá)
    // y agent_start (ya manejado arriba). Todo lo demás se descarta.
    return;
  }

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
    // Aún así limpiar si es agent_end o terminated.
    if (event.type === 'agent_end') {
      streamingSessionId = null;
      streamSettled = true;
      appState.isStreaming.value = false;
    }
    return;
  }

  // Si el target ya no es un tab abierto, descartar eventos intermedios,
  // pero permitir agent_end para limpiar el estado del store.
  const isOpen = appState.openTabs.value.some(
    (t) => t.id === targetId || t.file === targetId
  );
  if (!isOpen && event.type !== 'agent_end') {
    return;
  }

  // message_update: aplicar al buffer (delta en pi ≥ 0.84, message
  // completo en pi < 0.84) y throttlear el dispatch a ~20/s (50ms).
  // Los eventos intermedios se descartan; solo importa el estado
  // del buffer en cada intervalo.
  if (event.type === 'message_update') {
    const ev = event as PiMessageUpdateEvent;
    if (ev.message) partialMsg = ev.message as Record<string, unknown>;
    else applyMessageDelta(ev);
    pendingThrottledUpdate = { targetId };
    const now = performance.now();
    const elapsed = now - lastProcessedTime;
    if (elapsed >= THROTTLE_MS) {
      lastProcessedTime = now;
      flushThrottledUpdate();
    } else if (throttleFrameId === null) {
      const onFrame = () => {
        throttleFrameId = null;
        const t = performance.now();
        if (t - lastProcessedTime >= THROTTLE_MS) {
          lastProcessedTime = t;
          flushThrottledUpdate();
        } else if (pendingThrottledUpdate) {
          throttleFrameId = requestAnimationFrame(onFrame);
        }
      };
      throttleFrameId = requestAnimationFrame(onFrame);
    }
  } else {
    const chatEvents = mapStreamEvent(event);
    if (chatEvents.length === 0) return;
    const store = getStore(targetId);
    for (const ce of chatEvents) store.dispatch(ce);
  }

  // agent_end limpia el routing, el buffer de streaming y el flag global.
  if (event.type === 'agent_end') {
    streamingSessionId = null;
    streamSettled = true;
    partialMsg = null;
    // Limpiar throttle pendiente para que un rAF no re-active el store.
    pendingThrottledUpdate = null;
    if (throttleFrameId !== null) {
      cancelAnimationFrame(throttleFrameId);
      throttleFrameId = null;
    }
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
    case 'message_start': {
      // Inicializa el buffer del mensaje en curso. Desde pi 0.84 el
      // message_start trae el AgentMessage inicial (content vacío o
      // primer bloque) y los message_update solo traen deltas.
      const e = event as PiMessageStartEvent;
      partialMsg = (e.message as Record<string, unknown> | undefined) ?? null;
      return mapRawMessage(partialMsg, 'message_start');
    }
    case 'message_end': {
      // Autoritativo: reemplaza el buffer con el message final.
      const e = event as PiMessageEndEvent;
      return mapRawMessage(e.message, 'message_end');
    }
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

/** Mapea un AgentMessage raw (inicio o fin de mensaje) a su ChatEvent.
 *  El `message` viene con el AgentMessage completo (parcial o final).
 *  Lo pasamos por mapAgentMessage y, si es válido, emitimos el ChatEvent. */
function mapRawMessage(raw: unknown, kind: 'message_start' | 'message_end'): ChatEvent[] {
  const msg = mapAgentMessage(raw);
  if (!msg) return [];
  return [{ type: kind, message: msg }];
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