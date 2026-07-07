/**
 * Tests del SmoothStreamer: sentence-level markdown rendering.
 *
 * @vitest-environment jsdom
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { SmoothStreamer, splitSentences } from '../src/lib/smooth-streamer.ts';

describe('SmoothStreamer', () => {
  let onSentence: ReturnType<typeof vi.fn>;
  let onPending: ReturnType<typeof vi.fn>;
  let streamer: SmoothStreamer;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;

  beforeEach(() => {
    onSentence = vi.fn();
    onPending = vi.fn();
    streamer = new SmoothStreamer(onSentence, onPending);
    rafCallbacks = new Map();
    nextRafId = 1;

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      const id = nextRafId++;
      rafCallbacks.set(id, cb);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      rafCallbacks.delete(id);
    });
  });

  afterEach(() => {
    streamer.dispose();
    vi.restoreAllMocks();
  });

  function advanceFrame() {
    const cbs = Array.from(rafCallbacks.values());
    rafCallbacks.clear();
    for (const cb of cbs) cb(performance.now());
  }

  test('push sin sentence boundary solo llama onPending', () => {
    streamer.push('Hola ');
    advanceFrame();
    expect(onSentence).not.toHaveBeenCalled();
    expect(onPending).toHaveBeenCalledTimes(1);
    const html = onPending.mock.calls[0][0];
    expect(html).toContain('Hola');
  });

  test('oración completa genera onSentence sin pending', () => {
    streamer.push('Hola mundo.');
    advanceFrame();
    expect(onSentence).toHaveBeenCalledTimes(1);
    expect(onPending).not.toHaveBeenCalled();
  });

  test('oración completa + pendiente genera ambos callbacks', () => {
    streamer.push('Primera oración. Segunda');
    advanceFrame();
    expect(onSentence).toHaveBeenCalledTimes(1); // "Primera oración."
    expect(onPending).toHaveBeenCalledTimes(1);  // " Segunda"
  });

  test('múltiples pushes coalescen en un solo frame', () => {
    streamer.push('Primera oración. Segunda ');
    streamer.push('oración.');
    advanceFrame();
    expect(onSentence).toHaveBeenCalledTimes(2); // "Primera oración." + " Segunda oración."
  });

  test('flush renderiza el tail pendiente como oración final', () => {
    streamer.push('Oración completa. Tail');
    advanceFrame();
    expect(onSentence).toHaveBeenCalledTimes(1);
    expect(onPending).toHaveBeenCalledTimes(1);

    streamer.flush();
    // flush llama onPending con el tail
    expect(onPending).toHaveBeenCalledTimes(2);
  });

  test('flush cancela el rAF pendiente', () => {
    streamer.push('Texto');
    streamer.flush();
    expect(onPending).toHaveBeenCalledTimes(1);
    // Avanzar frame no debería causar otro render
    advanceFrame();
    expect(onPending).toHaveBeenCalledTimes(1);
  });

  test('dispose previene renders futuros', () => {
    streamer.dispose();
    streamer.push('No debería verse');
    advanceFrame();
    expect(onSentence).not.toHaveBeenCalled();
    expect(onPending).not.toHaveBeenCalled();
  });

  test('reset limpia el buffer y permite reuso', () => {
    streamer.push('Primera vida.');
    advanceFrame();
    expect(onSentence).toHaveBeenCalledTimes(1);

    streamer.reset();
    streamer.push('Segunda vida.');
    advanceFrame();
    expect(onSentence).toHaveBeenCalledTimes(2);
  });

  test('closeInlineSyntax en oración completa', () => {
    streamer.push('Hola **negrita** final.');
    advanceFrame();
    const html = onSentence.mock.calls[0][0];
    expect(html).toMatch(/<strong[^>]*>negrita<\/strong>/);
  });

  test('buffer vacío es no-op', () => {
    advanceFrame();
    expect(onSentence).not.toHaveBeenCalled();
    expect(onPending).not.toHaveBeenCalled();
  });

  test('push sin saltos mantiene solo pending', () => {
    streamer.push('esto es un texto largo sin puntuación que termina');
    advanceFrame();
    expect(onSentence).not.toHaveBeenCalled();
    expect(onPending).toHaveBeenCalled();
  });
});

describe('splitSentences', () => {
  test('oraciones separadas por .', () => {
    const { sentences, pending } = splitSentences('Una. Dos. Tres.');
    expect(sentences).toEqual(['Una.', ' Dos.', ' Tres.']);
    expect(pending).toBe('');
  });

  test('oración incompleta queda en pending', () => {
    const { sentences, pending } = splitSentences('Una. Dos. Tres');
    expect(sentences).toEqual(['Una.', ' Dos.']);
    expect(pending).toBe(' Tres');
  });

  test('salto de línea cuenta como boundary', () => {
    const { sentences, pending } = splitSentences('Línea 1\nLínea 2\n');
    expect(sentences).toEqual(['Línea 1\n', 'Línea 2\n']);
    expect(pending).toBe('');
  });

  test('no corta dentro de **bold**', () => {
    const { sentences, pending } = splitSentences('**bold text** here. And more.');
    expect(sentences).toEqual(['**bold text** here.', ' And more.']);
    expect(pending).toBe('');
  });

  test('no corta dentro de ~~strike~~', () => {
    const { sentences, pending } = splitSentences('~~strike. No cut~~');
    expect(sentences).toHaveLength(0);
    expect(pending).toBe('~~strike. No cut~~');
  });

  test('! y ? también son boundaries', () => {
    const { sentences } = splitSentences('¡Hola! ¿Cómo estás? Bien.');
    expect(sentences).toEqual(['¡Hola!', ' ¿Cómo estás?', ' Bien.']);
  });

  test('texto vacío', () => {
    const { sentences, pending } = splitSentences('');
    expect(sentences).toEqual([]);
    expect(pending).toBe('');
  });
});
