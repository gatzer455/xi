/**
 * Tests del ciclo de streaming del ChatBubble.
 * Verifican que la nueva arquitectura unificada funciona correctamente.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { ChatBubble } from '../src/components/chat-bubble.ts';
import { appState } from '../src/lib/state.ts';

// Helper: esperar N rAF
const waitFrames = (n = 2) =>
  new Promise<void>((r) => {
    let i = 0;
    const tick = () => {
      if (++i >= n) r();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

describe('ChatBubble streaming lifecycle', () => {
  beforeEach(() => {
    appState.streamingText.value = '';
  });

  test('user message: simple text, no markdown', () => {
    const handle = ChatBubble({
      id: 'u1', role: 'user', content: 'hola **no** se renderea',
      timestamp: Date.now(),
    });
    const text = handle.root.querySelector('.message-text--user')!;
    expect(text.textContent).toBe('hola **no** se renderea');
    expect(text.querySelector('strong')).toBeFalsy();
  });

  test('assistant non-streaming: renderiza markdown completo', () => {
    const handle = ChatBubble({
      id: 'a1', role: 'assistant', content: 'Hola **mundo**',
      timestamp: Date.now(),
    });
    const text = handle.root.querySelector('.message-text--assistant')!;
    expect(text.querySelector('strong')?.textContent).toBe('mundo');
    expect(text.classList.contains('message-text--streaming')).toBe(false);
  });

  test('assistant streaming: textContainer vacío + clase streaming', () => {
    const handle = ChatBubble({
      id: 'a2', role: 'assistant', content: '',
      timestamp: Date.now(),
      isStreaming: true,
    });
    const text = handle.root.querySelector('.message-text--assistant')!;
    expect(text.classList.contains('message-text--streaming')).toBe(true);
    expect(text.classList.contains('message-text--has-cursor')).toBe(true);
    expect(text.textContent).toBe('');
  });

  test('thinking block: dots cuando isStreaming=true, texto cuando false', () => {
    const handle1 = ChatBubble({
      id: 'a3', role: 'assistant', content: '',
      timestamp: Date.now(),
      thinking: [{ content: 'razonamiento' }],
      isStreaming: true,
    });
    const thinking1 = handle1.root.querySelector('.thinking-block')!;
    expect(thinking1.querySelector('.thinking-dots')).toBeTruthy();
    expect(thinking1.querySelector('.thinking-body')?.textContent).toBe('razonamiento');
    handle1.dispose();

    const handle2 = ChatBubble({
      id: 'a4', role: 'assistant', content: 'respuesta',
      timestamp: Date.now(),
      thinking: [{ content: 'razonamiento' }],
      isStreaming: false,
    });
    const thinking2 = handle2.root.querySelector('.thinking-block')!;
    expect(thinking2.querySelector('.thinking-dots')).toBeFalsy();
  });

  test('tool call: card con status pending, success tras update', () => {
    const msg = {
      id: 'a5', role: 'assistant' as const, content: '',
      timestamp: Date.now(),
      toolCalls: [{
        id: 'tc1', name: 'bash',
        arguments: { command: 'ls' },
      }],
    };
    const handle = ChatBubble(msg);
    expect(handle.root.querySelector('.tool-call--pending')).toBeTruthy();
    expect(handle.root.querySelector('.tool-call-name')?.textContent).toContain('ls');

    const updated = {
      ...msg,
      toolCalls: [{ ...msg.toolCalls[0], result: 'file.txt', isError: false }],
    };
    handle.update(updated);
    expect(handle.root.querySelector('.tool-call--success')).toBeTruthy();
    expect(handle.root.querySelector('.tool-call--pending')).toBeFalsy();
  });

  test('compaction: divider con tokens formateados', () => {
    const handle = ChatBubble({
      id: 'c1', role: 'compaction', content: 'summary text',
      timestamp: Date.now(),
      compaction: { tokensBefore: 12500 },
    });
    expect(handle.root.className).toContain('compaction');
    expect(handle.root.querySelector('.compaction-summary')?.textContent).toContain('12.5K');
  });

  test('toolResult: card con body', () => {
    const handle = ChatBubble({
      id: 'r1', role: 'toolResult', content: 'output text',
      timestamp: Date.now(),
      toolResult: { toolName: 'bash', isError: false },
    });
    expect(handle.root.querySelector('.tool-result-card')).toBeTruthy();
    expect(handle.root.querySelector('.tool-result-name')?.textContent).toContain('bash');
    expect(handle.root.querySelector('.tool-result-body')?.textContent).toBe('output text');
  });
});

describe('ChatBubble end-to-end streaming', () => {
  beforeEach(() => { appState.streamingText.value = ''; });

  test('streaming → end: renderiza markdown al final', async () => {
    const handle = ChatBubble({
      id: 'e1', role: 'assistant', content: 'Hello **world**',
      timestamp: Date.now(),
      isStreaming: true,
    });

    // Push texto
    appState.streamingText.value = 'Hello **wor';
    await waitFrames(3);

    appState.streamingText.value = 'Hello **world**';
    await waitFrames(3);

    // End streaming
    appState.streamingText.value = '';
    await waitFrames(3);

    // Verificar markdown renderizado
    const text = handle.root.querySelector('.message-text--assistant')!;
    expect(text.querySelector('strong')).toBeTruthy();
    expect(text.querySelector('strong')?.textContent).toBe('world');
    expect(text.classList.contains('message-text--streaming')).toBe(false);
    expect(text.classList.contains('message-text--has-cursor')).toBe(false);

    handle.dispose();
  });

  test('id estable preserva el streamer entre updates', async () => {
    // Crear bubble con isStreaming=true (arranca streamer)
    const msg = {
      id: 'stable', role: 'assistant' as const, content: '',
      timestamp: Date.now(),
      isStreaming: true,
    };
    const handle = ChatBubble(msg);

    // Push delta
    appState.streamingText.value = 'partial';
    await waitFrames(5);

    // El textContainer debería tener 'partial'
    const text = handle.root.querySelector('.message-text--assistant')!;
    expect(text.textContent).toBe('partial');

    // update con un message más completo (mismo id)
    handle.update({ ...msg, content: 'partial + more' });

    // El subscriber del streamer debería recibir el delta
    appState.streamingText.value = 'partial + more';
    await waitFrames(2);

    // Verificar que el texto se actualizó
    expect(text.textContent).toContain('partial');

    handle.dispose();
  });
});
