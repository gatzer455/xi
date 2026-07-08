/**
 * Tests del ChatBubble con el modelo de Parts (chat-architecture-v2).
 * Verifica el render por rol y el delta extraction en update() (D6).
 * La actualización por streaming usa DOM reconciliation (reconcileDom).
 *
 * @vitest-environment jsdom
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatBubble } from '../src/components/chat-bubble.ts';
import { setRevealInterval } from '../src/lib/smooth-streamer.ts';
import type { ChatMessage, Part, ToolCallPart } from '../src/lib/chat/types.ts';

// El streamer de ChatBubble usa una cadencia de ~200ms en producción.
// En los tests la forzamos a 0 para que cada rAF renderice de inmediato.
beforeEach(() => setRevealInterval(0));
afterEach(() => setRevealInterval(200));

// ─── Timer mocking ───────────────────────────────────────

/** Mock setInterval/clearInterval para tests que crean chips con spinner. */
function mockTimers() {
  const intervals = new Set<ReturnType<typeof setInterval>>();
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    const id = setInterval(fn, ms ?? 0, ...args);
    intervals.add(id);
    return id;
  }) as typeof setInterval);
  vi.spyOn(globalThis, 'clearInterval').mockImplementation(((id: ReturnType<typeof setInterval>) => {
    intervals.delete(id);
    clearInterval(id);
  }) as typeof clearInterval);
  return {
    clearAll: () => {
      for (const id of intervals) clearInterval(id);
      intervals.clear();
    },
    restore: () => vi.restoreAllMocks(),
  };
}

function mockRaf() {
  const cbs: Array<FrameRequestCallback> = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    const id = cbs.length + 1;
    cbs.push(cb);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  return {
    advance: () => {
      const batch = cbs.splice(0);
      for (const cb of batch) cb(performance.now());
    },
    restore: () => vi.restoreAllMocks(),
  };
}

// ─── builders ─────────────────────────────────────────────

function userMsg(id: string, text: string): ChatMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }], timestamp: 1000 };
}

function assistantMsg(
  id: string,
  parts: Part[],
  opts: { isStreaming?: boolean; timestamp?: number } = {},
): ChatMessage {
  return {
    id,
    role: 'assistant',
    parts,
    timestamp: opts.timestamp ?? 2000,
    isStreaming: opts.isStreaming,
  };
}

function text(text: string): Part {
  return { type: 'text', text };
}

function thinking(text: string): Part {
  return { type: 'thinking', text };
}

function toolCall(
  toolCallId: string,
  name: string,
  args: Record<string, unknown>,
  state: ToolCallPart['state'] = 'pending',
): Part {
  return { type: 'toolCall', toolCallId, name, arguments: args, state };
}

function toolResult(toolCallId: string, toolName: string, output: string, isError = false): ChatMessage {
  return {
    id: `toolResult_${toolCallId}`,
    role: 'toolResult',
    parts: [{ type: 'toolResult', toolCallId, toolName, result: { output }, isError }],
    timestamp: 3000,
  };
}

function compaction(tokensBefore: number, summary = 'summary text'): ChatMessage {
  return {
    id: 'compaction_1',
    role: 'compaction',
    parts: [{ type: 'compaction', summary, tokensBefore }],
    timestamp: 4000,
  };
}

// ─── tests por rol ─────────────────────────────────────────

describe('ChatBubble — render por rol', () => {
  test('user message: texto plano, sin markdown', () => {
    const handle = ChatBubble(userMsg('u1', 'hola **no** se renderea'));
    const el = handle.root.querySelector('.message-text--user')!;
    expect(el.textContent).toBe('hola **no** se renderea');
    expect(el.querySelector('strong')).toBeFalsy();
  });

  test('assistant non-streaming: renderiza markdown', () => {
    const handle = ChatBubble(assistantMsg('a1', [text('Hola **mundo**')]));
    const el = handle.root.querySelector('.message-text--assistant')!;
    expect(el.querySelector('strong')?.textContent).toBe('mundo');
    expect(el.classList.contains('message-text--streaming')).toBe(false);
  });

  test('assistant streaming: clase streaming activa', () => {
    const handle = ChatBubble(assistantMsg('a2', [text('')], { isStreaming: true }));
    const el = handle.root.querySelector('.message-text--assistant')!;
    expect(el.classList.contains('message-text--streaming')).toBe(true);
  });

  test('thinking: puntos animados cuando streaming, "Se pensó" cuando no', () => {
    const h1 = ChatBubble(assistantMsg('a3', [thinking('razonamiento')], { isStreaming: true }));
    const t1 = h1.root.querySelector('.thinking-chip')!;
    const label = t1.querySelector('.tool-chip-label')!;
    // El label tiene "Pensando" + span con dots animados CSS
    expect(label.textContent).toContain('Pensando');
    expect(label.querySelector('.thinking-dots-anim')).toBeTruthy();
    h1.dispose();

    const h2 = ChatBubble(assistantMsg('a4', [thinking('razonamiento')], { isStreaming: false }));
    const t2 = h2.root.querySelector('.thinking-chip')!;
    const label2 = t2.querySelector('.tool-chip-label')!;
    expect(label2.textContent).toContain('Se pensó');
    expect(label2.querySelector('.thinking-dots-anim')).toBeFalsy();
  });

  test('tool call: grupo colapsable se muestra con resumen en voz pasiva', () => {
    const msg = assistantMsg('a5', [toolCall('tc1', 'bash', { command: 'ls' }, 'pending')], { isStreaming: true });
    const handle = ChatBubble(msg);
    const group = handle.root.querySelector('.tool-call-group')!;
    expect(group).toBeTruthy();
    expect(group.querySelector('.tool-chip-summary')?.textContent).toContain('Se ejecutó');
    expect(handle.root.querySelector('.tool-chip-group--inferencing')).toBeTruthy();
  });

  test('tool call: update de pending a completed → fase cambia a writing', () => {
    const msg = assistantMsg('a6', [toolCall('tc2', 'grep', { pattern: 'x', path: '.' }, 'running')], { isStreaming: true });
    const handle = ChatBubble(msg);
    expect(handle.root.querySelector('.tool-chip-group--inferencing')).toBeTruthy();

    handle.update(assistantMsg('a6', [toolCall('tc2', 'grep', { pattern: 'x', path: '.' }, 'completed')], { isStreaming: true }));
    // Ya no hay tools activas + isStreaming → writing
    expect(handle.root.querySelector('.tool-chip-group--inferencing')).toBeFalsy();
    expect(handle.root.querySelector('.tool-chip-group--writing')).toBeTruthy();
  });

  test('compaction: divider con tokens formateados', () => {
    const handle = ChatBubble(compaction(12500));
    expect(handle.root.className).toContain('compaction');
    expect(handle.root.querySelector('.compaction-summary')?.textContent).toContain('12.5K');
    expect(handle.root.querySelector('.compaction-body')?.textContent).toBe('summary text');
  });

  test('toolResult: oculto (display none), resultado en chip', () => {
    const handle = ChatBubble(toolResult('tc1', 'bash', 'output text'));
    expect(handle.root.style.display).toBe('none');
    expect(handle.root.dataset.messageId).toBeTruthy();
  });

  test('toolResult con isError: igualmente oculto', () => {
    const handle = ChatBubble(toolResult('tc2', 'grep', 'not found', true));
    expect(handle.root.style.display).toBe('none');
  });
});

// ─── delta extraction (D6) con DOM reconciliation ─────────

describe('ChatBubble — delta extraction en update()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('streaming → end: contenido crece y se renderiza', () => {
    const raf = mockRaf();
    const handle = ChatBubble(assistantMsg('e1', [text('')], { isStreaming: true }));
    const el = handle.root.querySelector('.message-text--assistant')!;

    // Crece el texto durante streaming
    handle.update(assistantMsg('e1', [text('Primer párrafo.')], { isStreaming: true }));
    raf.advance();
    expect(el.textContent).toContain('Primer párrafo');

    // Sigue creciendo
    handle.update(assistantMsg('e1', [text('Primer párrafo. Segundo párrafo.')], { isStreaming: true }));
    raf.advance();
    expect(el.textContent).toContain('Segundo párrafo');

    // Stream termina
    handle.update(assistantMsg('e1', [text('Primer párrafo. Segundo párrafo.')], { isStreaming: false }));
    expect(el.classList.contains('message-text--streaming')).toBe(false);

    handle.dispose();
    raf.restore();
  });

  test('múltiples updates sin rAF intermedio coalescen', () => {
    const raf = mockRaf();
    const handle = ChatBubble(assistantMsg('e2', [text('')], { isStreaming: true }));
    const el = handle.root.querySelector('.message-text--assistant')!;

    // Múltiples updates sin rAF
    handle.update(assistantMsg('e2', [text('A')], { isStreaming: true }));
    handle.update(assistantMsg('e2', [text('AB')], { isStreaming: true }));
    handle.update(assistantMsg('e2', [text('ABC')], { isStreaming: true }));

    raf.advance();
    expect(el.textContent).toContain('ABC');

    handle.dispose();
    raf.restore();
  });

  test('id estable preserva el bubble entre updates', () => {
    const raf = mockRaf();
    const handle = ChatBubble(assistantMsg('s1', [text('')], { isStreaming: true }));

    handle.update(assistantMsg('s1', [text('Primer párrafo.\n\n')], { isStreaming: true }));
    raf.advance();

    handle.update(assistantMsg('s1', [text('Primer párrafo.\n\nSegundo')], { isStreaming: true }));
    raf.advance();

    const container = handle.root.querySelector('.message-text--assistant')!;
    expect(container.innerHTML).toContain('Primer párrafo');
    expect(container.innerHTML).toContain('Segundo');

    handle.dispose();
    raf.restore();
  });

  test('update con id distinto o rol distinto → no-op', () => {
    const handle = ChatBubble(userMsg('u_keep', 'original'));
    handle.update(assistantMsg('u_keep', [text('otro')]));
    expect(handle.root.querySelector('.message-text--user')?.textContent).toBe('original');
    handle.update(userMsg('u_otro', 'otro'));
    expect(handle.root.querySelector('.message-text--user')?.textContent).toBe('original');
  });

  test('dispose limpia el streamer sin explotar', () => {
    const raf = mockRaf();
    const handle = ChatBubble(assistantMsg('d1', [text('')], { isStreaming: true }));
    handle.update(assistantMsg('d1', [text('algo')], { isStreaming: true }));
    raf.advance();
    expect(() => handle.dispose()).not.toThrow();
    raf.restore();
  });

  test('restore: fin del stream no deja residuos', () => {
    const raf = mockRaf();
    const handle = ChatBubble(assistantMsg('r1', [text('')], { isStreaming: true }));
    const el = handle.root.querySelector('.message-text--assistant')!;

    handle.update(assistantMsg('r1', [text('Oración completa.')], { isStreaming: true }));
    raf.advance();

    // Finalizar stream
    handle.update(assistantMsg('r1', [text('Oración completa.')], { isStreaming: false }));
    expect(el.classList.contains('message-text--streaming')).toBe(false);

    handle.dispose();
    raf.restore();
  });
});
