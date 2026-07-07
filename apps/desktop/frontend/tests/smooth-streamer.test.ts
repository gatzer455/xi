/**
 * Tests del SmoothStreamer: frame-level markdown rendering.
 *
 * @vitest-environment jsdom
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { SmoothStreamer } from '../src/lib/smooth-streamer.ts';

describe('SmoothStreamer', () => {
  let onHtml: ReturnType<typeof vi.fn>;
  let streamer: SmoothStreamer;
  let rafCallbacks: Map<number, FrameRequestCallback> = new Map();
  let nextRafId = 1;

  beforeEach(() => {
    onHtml = vi.fn();
    streamer = new SmoothStreamer(onHtml);
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

  test('push acumula texto y llama onHtml en el siguiente frame', () => {
    streamer.push('Hello');
    expect(onHtml).not.toHaveBeenCalled();
    advanceFrame();
    expect(onHtml).toHaveBeenCalledTimes(1);
    expect(onHtml).toHaveBeenCalledWith(expect.stringContaining('Hello'));
  });

  test('múltiples pushes coalescen en un solo onHtml por frame', () => {
    streamer.push('Hello ');
    streamer.push('**mundo**');
    expect(onHtml).not.toHaveBeenCalled();
    advanceFrame();
    expect(onHtml).toHaveBeenCalledTimes(1);
    const html = onHtml.mock.calls[0][0];
    expect(html).toContain('Hello');
    expect(html).toMatch(/<strong[^>]*>mundo<\/strong>/);
  });

  test('dos frames consecutivos generan dos llamadas a onHtml', () => {
    streamer.push('Primero');
    advanceFrame();
    expect(onHtml).toHaveBeenCalledTimes(1);

    streamer.push(' segundo');
    advanceFrame();
    expect(onHtml).toHaveBeenCalledTimes(2);
    expect(onHtml.mock.calls[1][0]).toContain('Primero');
    expect(onHtml.mock.calls[1][0]).toContain('segundo');
  });

  test('flush llama onHtml inmediatamente sin esperar frame', () => {
    streamer.push('Inmediato');
    expect(onHtml).not.toHaveBeenCalled();
    streamer.flush();
    expect(onHtml).toHaveBeenCalledTimes(1); // no espera rAF
    expect(onHtml).toHaveBeenCalledWith(expect.stringContaining('Inmediato'));
  });

  test('flush cancela el rAF pendiente', () => {
    streamer.push('Texto');
    streamer.flush();
    expect(onHtml).toHaveBeenCalledTimes(1);
    // El rAF estaba pendiente. Avanzar frame no debería causar otro render.
    advanceFrame();
    expect(onHtml).toHaveBeenCalledTimes(1);
  });

  test('dispose previene renders futuros', () => {
    streamer.dispose();
    streamer.push('No debería verse');
    advanceFrame();
    expect(onHtml).not.toHaveBeenCalled();
  });

  test('reset limpia el buffer y permite reuso', () => {
    streamer.push('Primera vida');
    advanceFrame();
    expect(onHtml).toHaveBeenCalledTimes(1);

    streamer.reset();
    streamer.push('Segunda vida');
    advanceFrame();
    expect(onHtml).toHaveBeenCalledTimes(2);
    expect(onHtml.mock.calls[1][0]).toContain('Segunda vida');
    expect(onHtml.mock.calls[1][0]).not.toContain('Primera vida');
  });

  test('cierra bold incompleto con closeInlineSyntax', () => {
    streamer.push('Hola **negrita');
    advanceFrame();
    const html = onHtml.mock.calls[0][0];
    expect(html).toMatch(/<strong[^>]*>negrita<\/strong>/);
  });

  test('cierra inline code incompleto', () => {
    streamer.push('Usa `comando');
    advanceFrame();
    const html = onHtml.mock.calls[0][0];
    expect(html).toMatch(/<code[^>]*>comando<\/code>/);
  });

  test('buffer vacío no dispara onHtml', () => {
    // Sin push, solo avanzar el frame
    advanceFrame();
    expect(onHtml).not.toHaveBeenCalled();
  });

  test('flush con buffer vacío es no-op', () => {
    streamer.flush();
    expect(onHtml).not.toHaveBeenCalled();
  });

  test('push después de dispose es no-op', () => {
    streamer.dispose();
    streamer.push('olvidado');
    streamer.flush();
    advanceFrame();
    expect(onHtml).not.toHaveBeenCalled();
  });
});
