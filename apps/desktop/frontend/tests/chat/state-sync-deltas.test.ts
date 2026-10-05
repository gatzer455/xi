/**
 * state-sync-deltas.test.ts — Ensamblado de `message_update` por deltas
 * (contrato de pi ≥ 0.84: ya no trae el campo acumulativo `message`).
 *
 * pi 0.84.0 (2026-08-06, #7290) eliminó `message` y
 * `assistantMessageEvent.partial` de `message_update`: ahora emite solo
 * deltas (`text_delta`, `thinking_delta`, `toolcall_delta` con
 * `contentIndex`). El cliente debe ensamblar el partial entre
 * `message_start` (inicializa) y `message_end` (autoritativo).
 *
 * Estos tests alimentan `applyEvent` con la secuencia de deltas real
 * (mismo código que corre en producción con pi ≥ 0.84) y verifican que
 * el ChatStore recibe el mensaje ensamblado.
 *
 * @vitest-environment jsdom
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { userMessage, assistantFinal } from './fixtures/pi-events.ts';

// Mismo mock de appState que state-sync-integration.test.ts.
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
  return {
    createMockAppState: () => ({
      activeTabId: mockSignal<string | null>(null),
      isStreaming: mockSignal(false),
      currentModel: mockSignal(null),
      thinkingLevel: mockSignal('medium'),
      availableModels: mockSignal([]),
      session: mockSignal(null),
      openTabs: mockSignal<Array<{ id: string; file?: string }>>([]),
    }),
  };
});

vi.mock('xi-ui/lib/state.ts', () => ({
  appState: mockState.createMockAppState(),
  toTabId: (x: string) => x as any,
  toSessionPath: (x: string) => x as any,
}));

vi.mock('xi-ui/lib/debug-panel.ts', () => ({
  addEntry: vi.fn(),
}));

import { applyEvent, beginStreamForSession, endStream } from 'xi-ui/lib/pi/state-sync.ts';
import { getStore, clearStores } from 'xi-ui/lib/chat/stores.ts';
import { appState } from 'xi-ui/lib/state.ts';

const activeTabId = appState.activeTabId as unknown as { value: string | null };
const openTabs = appState.openTabs as unknown as { value: Array<{ id: string }> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Evento message_update con SOLO deltas (contrato pi ≥ 0.84). */
function delta(type: string, extra: Record<string, unknown> = {}): unknown {
  return {
    type: 'message_update',
    assistantMessageEvent: { type, ...extra },
  };
}

/** message_start del assistant (trae el message inicial, sin usage). */
function asstStart(timestamp: number): unknown {
  return { type: 'message_start', message: { role: 'assistant', content: [], timestamp } };
}

function messagesOf(tabId: string) {
  return getStore(tabId).messages$.value;
}

beforeEach(() => {
  clearStores();
  activeTabId.value = null;
  openTabs.value = [];
});

describe('state-sync — ensamblado por deltas (pi ≥ 0.84)', () => {
  test('text_delta ensambla el partial y message_end lo reemplaza (autoritativo)', async () => {
    activeTabId.value = 'tab-A';
    openTabs.value = [{ id: 'tab-A' }];
    beginStreamForSession('tab-A');
    const ts = 1000;

    applyEvent(asstStart(ts));
    applyEvent(delta('text_start', { contentIndex: 0 }));
    applyEvent(delta('text_delta', { contentIndex: 0, delta: 'Ho' }));
    applyEvent(delta('text_delta', { contentIndex: 0, delta: 'la' }));
    // Esperar el flush del throttle (~50ms + rAF).
    await sleep(120);

    let asst = messagesOf('tab-A').find((m) => m.role === 'assistant');
    expect(asst).toBeDefined();
    const textOf = (m: typeof asst) =>
      m?.parts.find((p) => p.type === 'text') && (m!.parts.find((p) => p.type === 'text') as { text: string }).text;
    expect(textOf(asst)).toBe('Hola');

    // message_end reemplaza con el mensaje final (usage, stopReason).
    applyEvent({
      type: 'message_end',
      message: assistantFinal('Hola mundo', ts),
    });
    await sleep(20);

    asst = messagesOf('tab-A').find((m) => m.role === 'assistant');
    expect(textOf(asst)).toBe('Hola mundo');
    expect(asst?.id).toBe('assistant_1000'); // ID estable (D4)
    endStream();
  });

  test('thinking y text conviven por contentIndex', async () => {
    activeTabId.value = 'tab-A';
    openTabs.value = [{ id: 'tab-A' }];
    beginStreamForSession('tab-A');

    applyEvent(asstStart(2000));
    applyEvent(delta('thinking_start', { contentIndex: 0 }));
    applyEvent(delta('thinking_delta', { contentIndex: 0, delta: 'Pienso' }));
    applyEvent(delta('text_start', { contentIndex: 1 }));
    applyEvent(delta('text_delta', { contentIndex: 1, delta: 'Res' }));
    await sleep(120);

    const asst = messagesOf('tab-A').find((m) => m.role === 'assistant')!;
    const thinking = asst.parts.find((p) => p.type === 'thinking') as { text: string };
    const text = asst.parts.find((p) => p.type === 'text') as { text: string };
    expect(thinking.text).toBe('Pienso');
    expect(text.text).toBe('Res');
    endStream();
  });

  test('toolcall deltas ensamblan arguments (JSON parseado cuando completa)', async () => {
    activeTabId.value = 'tab-A';
    openTabs.value = [{ id: 'tab-A' }];
    beginStreamForSession('tab-A');

    applyEvent(asstStart(3000));
    applyEvent(delta('toolcall_start', { contentIndex: 0 }));
    applyEvent(delta('toolcall_delta', { contentIndex: 0, delta: '{"comm' }));
    await sleep(120);

    // JSON incompleto → arguments crudo (string), el mapping lo degrada a {}.
    let asst = messagesOf('tab-A').find((m) => m.role === 'assistant')!;
    let tc = asst.parts.find((p) => p.type === 'toolCall') as { arguments: unknown };
    expect(tc).toBeDefined();
    expect(tc.arguments).toEqual({});

    // JSON completo → se parsea.
    applyEvent(delta('toolcall_delta', { contentIndex: 0, delta: 'and":"ls"}' }));
    await sleep(120);

    asst = messagesOf('tab-A').find((m) => m.role === 'assistant')!;
    tc = asst.parts.find((p) => p.type === 'toolCall') as { arguments: Record<string, unknown> };
    expect(tc.arguments).toEqual({ command: 'ls' });

    // toolcall_end reemplaza con el ToolCall completo (id, name).
    applyEvent(delta('toolcall_end', {
      contentIndex: 0,
      toolCall: { type: 'toolCall', id: 'call_1', name: 'bash', arguments: { command: 'ls' } },
    }));
    await sleep(120);

    asst = messagesOf('tab-A').find((m) => m.role === 'assistant')!;
    tc = asst.parts.find((p) => p.type === 'toolCall') as { toolCallId: string; name: string };
    expect(tc.toolCallId).toBe('call_1');
    expect(tc.name).toBe('bash');
    endStream();
  });

  test('sin message_start previo, los deltas se descartan (message_end igual llega)', async () => {
    activeTabId.value = 'tab-A';
    openTabs.value = [{ id: 'tab-A' }];
    beginStreamForSession('tab-A');

    // Delta sin buffer (no debería crashear ni producir mensaje).
    applyEvent(delta('text_delta', { contentIndex: 0, delta: 'huérfano' }));
    await sleep(120);
    expect(messagesOf('tab-A').filter((m) => m.role === 'assistant').length).toBe(0);

    // El message_end autoritativo igual llega.
    applyEvent({ type: 'message_end', message: assistantFinal('final', 4000) });
    await sleep(20);
    const asst = messagesOf('tab-A').find((m) => m.role === 'assistant')!;
    const text = asst.parts.find((p) => p.type === 'text') as { text: string };
    expect(text.text).toBe('final');
  });

  test('secuencia completa de turno: user + deltas + toolResult', async () => {
    activeTabId.value = 'tab-A';
    openTabs.value = [{ id: 'tab-A' }];
    beginStreamForSession('tab-A');

    applyEvent({ type: 'message_start', message: userMessage('hola', 100) });
    applyEvent(asstStart(200));
    applyEvent(delta('text_start', { contentIndex: 0 }));
    applyEvent(delta('text_delta', { contentIndex: 0, delta: 'Hola mundo' }));
    applyEvent({
      type: 'message_end',
      message: { role: 'toolResult', toolCallId: 'call_1', toolName: 'bash', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 300 },
    });
    applyEvent({
      type: 'agent_end',
      messages: [
        userMessage('hola', 100),
        assistantFinal('Hola mundo', 200),
        { role: 'toolResult', toolCallId: 'call_1', toolName: 'bash', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 300 },
      ],
    });
    await sleep(20);

    const msgs = messagesOf('tab-A');
    expect(msgs.length).toBe(3);
    expect(msgs.some((m) => m.role === 'toolResult')).toBe(true);
    const asst = msgs.find((m) => m.role === 'assistant')!;
    const text = asst.parts.find((p) => p.type === 'text') as { text: string };
    expect(text.text).toBe('Hola mundo');
    expect(asst.isStreaming).toBeFalsy();
  });
});
