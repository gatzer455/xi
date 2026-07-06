/**
 * state-sync-integration.test.ts — Pruebas de integración de la capa
 * state-sync vía `applyEvent` (el punto de entrada real de pi).
 *
 * Etapa 12 (chat-architecture-v2). Desviación literal de los reqs
 * (que decían "E2E"): un E2E real de chat necesita API key de un LLM
 * + red, y el CI no la tiene. En vez de eso, alimentamos secuencias
 * de PiEvents (ver tests/chat/fixtures/pi-events.ts) directamente a
 * `applyEvent` — el mimo código que corre en producción cuando pi
 * emite eventos — y verificamos el estado resultante del ChatStore.
 * Es determinista, rápido y CI-viable.
 *
 * El contenido de los mensajes es trivial ("hola", "Hola mundo"):
 * la corrección de xi NO depende del sentido del mensaje ni del
 * provider. Un error acá es un error de xi; un error del provider
 * nunca llega a este test. Ver fixtures/pi-events.ts para el
 * contrato de separación.
 *
 * Atrapa los dos bugs del catálogo que el refactor debía resolver:
 *
 *  - **"chat vacío al terminar stream"** (#5): tras agent_end los
 *    messages siguen presentes y isStreaming baja.
 *  - **"multi-tab routing"** (#1): streamear en tab A, cambiar a tab B
 *    mid-stream → el contenido queda en A, no en B (routing por
 *    streamingSessionId reclamado en beginStreamForSession).
 *
 * @vitest-environment jsdom
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  ev,
  runSimpleTurn,
  userMessage,
  assistantPartial,
  assistantFinal,
  assistantWithToolCall,
  toolResultMessage,
} from './fixtures/pi-events.ts';

// ─── Mock appState (controllable activeTabId + observable isStreaming) ────
//
// vi.mock factories se hoistean ANTES de los imports del modulo. Por
// eso las signals compartidas viven dentro de vi.hoisted() y las
// exponemos a los tests via los getters/setters que el factory entrega.
const mockState = vi.hoisted(() => {
  function mockSignal<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      get value() { return value; },
      set value(v: T) {
        if (v === value) return;
        value = v;
        subs.forEach((fn) => fn(value));
      },
      subscribe(fn: (v: T) => void) {
        subs.add(fn);
        fn(value);
        return () => { subs.delete(fn); };
      },
    };
  }

  const activeTabId = mockSignal<string | null>(null);
  const isStreaming = mockSignal(false);
  const currentModel = mockSignal(null);
  const openTabs = mockSignal<Array<{ id: string; file?: string }>>([]);

  // Los tipos que state-sync importa (PiModel, ThinkingLevel, Session)
  // se borran en runtime; el factory solo necesita exportar el appState.
  return {
    createMockAppState: () => ({
      activeTabId,
      isStreaming,
      currentModel,
      thinkingLevel: mockSignal('medium'),
      availableModels: mockSignal([]),
      session: mockSignal(null),
      openTabs,
    }),
    activeTabId,
    isStreaming,
    currentModel,
    openTabs,
  };
});

vi.mock('../../src/lib/state.ts', () => ({
  appState: mockState.createMockAppState(),
}));

vi.mock('../../src/lib/debug-panel.ts', () => ({
  addEntry: vi.fn(),
}));

// stores.ts y mapping.ts quedan reales → aislamiento real por id.
import { applyEvent, beginStreamForSession, endStream } from '../../src/lib/pi/state-sync.ts';
import { getStore, clearStores } from '../../src/lib/chat/stores.ts';

const { activeTabId, isStreaming, currentModel, openTabs } = mockState;

function setOpenTabs(ids: string[]): void {
  openTabs.value = ids.map((id) => ({ id }));
}

// ─── Helpers de aserción ───────────────────────────────────

function messagesOf(tabId: string) {
  return getStore(tabId).messages$.value;
}

function streamingOf(tabId: string) {
  return getStore(tabId).isStreaming$.value;
}

// ─── Setup ─────────────────────────────────────────────────

beforeEach(() => {
  clearStores();
  activeTabId.value = null;
  isStreaming.value = false;
  currentModel.value = null;
  openTabs.value = [];
});

// ═══════════════════════════════════════════════════════════
// Bug catálogo #5: "chat vacío al terminar stream"
// ═══════════════════════════════════════════════════════════

describe('Bug #5 — chat NO queda vacío tras agent_end', () => {
  test('secuencia completa de un turno: el contenido queda visible', () => {
    activeTabId.value = 'tab-A';
    setOpenTabs(["tab-A"]);
    // Reclamar el routing ANTES de mandar el prompt (como hace input.ts).
    beginStreamForSession('tab-A');

    runSimpleTurn(applyEvent, 'tab-A', 'hola', 'Hola mundo');

    // El bug: tras agent_end el chat quedaba vacío. Ahora NO.
    const msgs = messagesOf('tab-A');
    expect(msgs.length).toBe(2);
    expect(msgs.some((m) => m.role === 'user')).toBe(true);
    expect(msgs.some((m) => m.role === 'assistant')).toBe(true);

    const asst = msgs.find((m) => m.role === 'assistant')!;
    const textPart = asst.parts.find((p) => p.type === 'text');
    expect(textPart && textPart.type === 'text' ? textPart.text : '').toBe('Hola mundo');
    expect(asst.isStreaming).toBeFalsy();

    // isStreaming global baja (lo usa el footer).
    expect(isStreaming.value).toBe(false);
    expect(streamingOf('tab-A')).toBe(false);
  });

  test('get_messages (cargar sesión existente) preserva IDs estables', () => {
    activeTabId.value = 'tab-A';
    setOpenTabs(["tab-A"]);

    // Primero un turno completo deja messages en el store.
    beginStreamForSession('tab-A');
    runSimpleTurn(applyEvent, 'tab-A', 'hola', 'Hola respuesta', 1000, 2000);

    // Ahora simulamos abrir la MISMA sesión: pi envía get_messages con el
    // historial. Antes del refactor, IDs nuevos dejaban handles orfanos
    // (bug #3). Ahora el reducer reemplaza por id estable (role_ts).
    applyEvent(ev.response('get_messages', true, {
      messages: [
        userMessage('hola', 1000),
        assistantFinal('Hola respuesta', 2000),
      ],
    }));

    const msgs = messagesOf('tab-A');
    expect(msgs.length).toBe(2);
    expect(msgs[0].id).toBe('user_1000');
    expect(msgs[1].id).toBe('assistant_2000');
  });
});

// ═══════════════════════════════════════════════════════════
// Bug catálogo #1: multi-tab routing con streamingSessionId
// ═══════════════════════════════════════════════════════════

describe('Bug #1 — multi-tab routing (streamingSessionId)', () => {
  test('cambiar de tab mid-stream deja el contenido en el tab original', () => {
    activeTabId.value = 'tab-A';
    setOpenTabs(["tab-A"]);
    const userTs = 1000;
    const asstTs = 2000;

    // El usuario manda un prompt DESDE tab-A. input.ts reclama el routing.
    beginStreamForSession('tab-A');

    applyEvent(ev.agent_start());
    applyEvent(ev.message_start(userMessage('hola', userTs)));
    applyEvent(ev.message_end(userMessage('hola', userTs)));

    applyEvent(ev.message_start(assistantPartial('Ho', asstTs)));
    applyEvent(ev.message_update(assistantPartial('Hola', asstTs), 'la'));

    // ⚡ El usuario cambia a tab-B mid-stream.
    activeTabId.value = 'tab-B';

    // Los deltas siguientes NO deben ir a tab-B (la activa), sino a tab-A
    // (la que reclamo el stream). Esta es la esencia del bug #1.
    applyEvent(ev.message_update(assistantPartial('Hola mundo', asstTs), ' mundo'));
    applyEvent(ev.message_end(assistantFinal('Hola mundo', asstTs)));

    applyEvent(ev.agent_end([
      userMessage('hola', userTs),
      assistantFinal('Hola mundo', asstTs),
    ]));

    // tab-A tiene TODO el contenido del turno.
    const aMsgs = messagesOf('tab-A');
    expect(aMsgs.length).toBe(2);
    const aAsst = aMsgs.find((m) => m.role === 'assistant')!;
    const aText = aAsst.parts.find((p) => p.type === 'text');
    expect(aText && aText.type === 'text' ? aText.text : '').toBe('Hola mundo');

    // tab-B esta vacía — NO recibio el stream de tab-A.
    const bMsgs = messagesOf('tab-B');
    expect(bMsgs.length).toBe(0);

    // El flag global baja (footer se oculta en cualquier tab).
    expect(isStreaming.value).toBe(false);
  });

  test('agent_start sin claim previo cae al activeTabId como fallback', () => {
    // Continuación por compaction/steering que pi dispara sin que el
    // usuario mandara un prompt. No hubo beginStreamForSession.
    activeTabId.value = 'tab-C';
    setOpenTabs(['tab-C']);

    applyEvent(ev.agent_start());
    applyEvent(ev.message_start(assistantPartial('continuación', 5000)));
    applyEvent(ev.message_end(assistantFinal('continuación', 5000)));
    applyEvent(ev.agent_end([assistantFinal('continuación', 5000)]));

    const msgs = messagesOf('tab-C');
    expect(msgs.length).toBe(1);
    expect(msgs[0].role).toBe('assistant');
    expect(isStreaming.value).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// Tool calls + tool results (D8: state string + mensaje aparte)
// ═══════════════════════════════════════════════════════════

describe('Tool calls — estado via tool_execution_* + toolResult aparte', () => {
  test('toolCall arranca pending, tool_execution lo pasa a completed, toolResult es mensaje separado', () => {
    activeTabId.value = 'tab-A';
    setOpenTabs(["tab-A"]);
    const userTs = 1000;
    const asstTs = 2000;
    const toolCallId = 'tc-1';
    const trTs = 3000;

    beginStreamForSession('tab-A');
    applyEvent(ev.agent_start());
    applyEvent(ev.message_start(userMessage('listame archivos', userTs)));
    applyEvent(ev.message_end(userMessage('listame archivos', userTs)));

    applyEvent(ev.message_start(assistantWithToolCall(asstTs, toolCallId)));
    // El ToolCallPart arranca en state 'pending' (mapping).
    applyEvent(ev.message_end(assistantWithToolCall(asstTs, toolCallId)));

    // tool_execution lleva el state a 'running' y luego 'completed'.
    applyEvent(ev.tool_execution_start(toolCallId));
    applyEvent(ev.tool_execution_end(toolCallId, false));

    // El toolResult llega como su propio message_start/end.
    applyEvent(ev.message_start(toolResultMessage(toolCallId, trTs, 'file1.txt\nfile2.txt')));
    applyEvent(ev.message_end(toolResultMessage(toolCallId, trTs, 'file1.txt\nfile2.txt')));

    applyEvent(ev.agent_end([
      userMessage('listame archivos', userTs),
      assistantWithToolCall(asstTs, toolCallId),
      toolResultMessage(toolCallId, trTs, 'file1.txt\nfile2.txt'),
    ]));

    const msgs = messagesOf('tab-A');
    // user + assistant + toolResult = 3 mensajes.
    expect(msgs.length).toBe(3);

    const asst = msgs.find((m) => m.role === 'assistant')!;
    const tc = asst.parts.find((p) => p.type === 'toolCall');
    expect(tc && tc.type === 'toolCall' ? tc.state : '').toBe('completed');

    const tr = msgs.find((m) => m.role === 'toolResult');
    expect(tr).toBeTruthy();
  });

  test('tool_execution_end con isError → state "failed"', () => {
    activeTabId.value = 'tab-A';
    setOpenTabs(["tab-A"]);
    const asstTs = 2000;
    const toolCallId = 'tc-err';

    beginStreamForSession('tab-A');
    applyEvent(ev.agent_start());
    applyEvent(ev.message_start(assistantWithToolCall(asstTs, toolCallId)));
    applyEvent(ev.message_end(assistantWithToolCall(asstTs, toolCallId)));
    applyEvent(ev.tool_execution_start(toolCallId));
    applyEvent(ev.tool_execution_end(toolCallId, true));
    applyEvent(ev.agent_end([assistantWithToolCall(asstTs, toolCallId)]));

    const asst = messagesOf('tab-A').find((m) => m.role === 'assistant')!;
    const tc = asst.parts.find((p) => p.type === 'toolCall');
    expect(tc && tc.type === 'toolCall' ? tc.state : '').toBe('failed');
  });
});

// ═══════════════════════════════════════════════════════════
// Abort / terminated — el footer (isStreaming) se libera
// ═══════════════════════════════════════════════════════════

describe('Abort / terminated — isStreaming global se libera', () => {
  test('endStream() limpia el flag y el routing (abort desde InputBar)', () => {
    activeTabId.value = 'tab-A';
    setOpenTabs(['tab-A']);
    beginStreamForSession('tab-A');
    applyEvent(ev.agent_start());
    expect(isStreaming.value).toBe(true);

    // El usuario aprieta Stop → input.ts llama endStream().
    endStream();
    expect(isStreaming.value).toBe(false);

    // Un agent_end tardío NO revive el flag (ya sin routing).
    applyEvent(ev.agent_end([]));
    expect(isStreaming.value).toBe(false);
  });

  test('pi terminated (lado del backend) libera el flag via endStream', () => {
    activeTabId.value = 'tab-A';
    setOpenTabs(['tab-A']);
    beginStreamForSession('tab-A');
    applyEvent(ev.agent_start());
    expect(isStreaming.value).toBe(true);

    // init.ts escucha pi:terminated y llama endStream.
    endStream();
    expect(isStreaming.value).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// get_state response — popula currentModel (lo lee el header/footer)
// ═══════════════════════════════════════════════════════════

describe('response get_state — popula modelo global', () => {
  test('get_state exitoso setea currentModel', () => {
    activeTabId.value = 'tab-A';
    setOpenTabs(["tab-A"]);
    applyEvent(ev.response('get_state', true, {
      model: { id: 'gpt-4', name: 'GPT-4' },
      thinkingLevel: 'high',
      sessionFile: '/p.jsonl',
      sessionId: 's1',
      sessionName: 'test',
      messageCount: 5,
    }));

    expect(currentModel.value).toEqual({ id: 'gpt-4', name: 'GPT-4' });
  });
});