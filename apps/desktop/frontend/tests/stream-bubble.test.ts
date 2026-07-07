/**
 * Tests del ChatBubble con el modelo de Parts (chat-architecture-v2).
 * Verifica el render por rol y el delta extraction en update() (D6).
 * La actualización por streaming usa DOM reconciliation (reconcileDom).
 *
 * @vitest-environment jsdom
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { ChatBubble } from '../src/components/chat-bubble.ts';
import type { ChatMessage, Part, ToolCallPart } from '../src/lib/chat/types.ts';

// ─── rAF mocking ─────────────────────────────────────────

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

  test('thinking: dots cuando isStreaming, texto cuando no', () => {
    const h1 = ChatBubble(assistantMsg('a3', [thinking('razonamiento')], { isStreaming: true }));
    const t1 = h1.root.querySelector('.thinking-block')!;
    expect(t1.querySelector('.thinking-dots')).toBeTruthy();
    expect(t1.querySelector('.thinking-body')?.textContent).toBe('razonamiento');
    h1.dispose();

    const h2 = ChatBubble(assistantMsg('a4', [thinking('razonamiento')], { isStreaming: false }));
    const t2 = h2.root.querySelector('.thinking-block')!;
    expect(t2.querySelector('.thinking-dots')).toBeFalsy();
  });

  test('tool call: pending → update a completed → success', () => {
    const msg = assistantMsg('a5', [toolCall('tc1', 'bash', { command: 'ls' }, 'pending')]);
    const handle = ChatBubble(msg);
    expect(handle.root.querySelector('.tool-call--pending')).toBeTruthy();
    expect(handle.root.querySelector('.tool-call-name')?.textContent).toContain('ls');
    expect(handle.root.querySelector('.tool-call--success')).toBeFalsy();

    handle.update(assistantMsg('a5', [toolCall('tc1', 'bash', { command: 'ls' }, 'completed')]));
    expect(handle.root.querySelector('.tool-call--success')).toBeTruthy();
    expect(handle.root.querySelector('.tool-call--pending')).toBeFalsy();
  });

  test('tool call: update a failed → error', () => {
    const handle = ChatBubble(assistantMsg('a6', [toolCall('tc2', 'grep', { pattern: 'x', path: '.' }, 'running')]));
    handle.update(assistantMsg('a6', [toolCall('tc2', 'grep', { pattern: 'x', path: '.' }, 'failed')]));
    expect(handle.root.querySelector('.tool-call--error')).toBeTruthy();
  });

  test('compaction: divider con tokens formateados', () => {
    const handle = ChatBubble(compaction(12500));
    expect(handle.root.className).toContain('compaction');
    expect(handle.root.querySelector('.compaction-summary')?.textContent).toContain('12.5K');
    expect(handle.root.querySelector('.compaction-body')?.textContent).toBe('summary text');
  });

  test('toolResult: card con body', () => {
    const handle = ChatBubble(toolResult('tc1', 'bash', 'output text'));
    expect(handle.root.querySelector('.tool-result-card')).toBeTruthy();
    expect(handle.root.querySelector('.tool-result-name')?.textContent).toContain('bash');
    expect(handle.root.querySelector('.tool-result-body')?.textContent).toBe('output text');
  });

  test('toolResult con isError → clase error', () => {
    const handle = ChatBubble(toolResult('tc2', 'grep', 'not found', true));
    expect(handle.root.querySelector('.tool-result-card--error')).toBeTruthy();
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
