/**
 * Tests del SmoothStreamer + reconcileDom + delta animation.
 *
 * @vitest-environment jsdom
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { SmoothStreamer, reconcileDom } from '../src/lib/smooth-streamer.ts';

function fadeInSpans(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll('span.fade-in'));
}

describe('SmoothStreamer', () => {
  let onHtml: ReturnType<typeof vi.fn>;
  let streamer: SmoothStreamer;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;

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

  test('push acumula y renderiza el buffer completo en rAF', () => {
    streamer.push('Hola mundo');
    advanceFrame();
    expect(onHtml).toHaveBeenCalledTimes(1);
    const html = onHtml.mock.calls[0][0];
    expect(html).toContain('Hola mundo');
  });

  test('múltiples pushes coalescen en un solo frame', () => {
    streamer.push('Hola ');
    streamer.push('mundo.');
    advanceFrame();
    expect(onHtml).toHaveBeenCalledTimes(1);
    expect(onHtml.mock.calls[0][0]).toContain('Hola mundo.');
  });

  test('flush renderiza inmediatamente sin esperar rAF', () => {
    streamer.push('Texto');
    streamer.flush();
    expect(onHtml).toHaveBeenCalledTimes(1);
    advanceFrame();
    expect(onHtml).toHaveBeenCalledTimes(1);
  });

  test('dispose previene renders futuros', () => {
    streamer.dispose();
    streamer.push('No debe renderizar');
    advanceFrame();
    expect(onHtml).not.toHaveBeenCalled();
  });

  test('reset limpia buffer y permite reuso', () => {
    streamer.push('Primera vida.');
    advanceFrame();
    expect(onHtml).toHaveBeenCalledTimes(1);

    streamer.reset();
    streamer.push('Segunda vida.');
    advanceFrame();
    expect(onHtml).toHaveBeenCalledTimes(2);
  });

  test('buffer vacío sin push es no-op', () => {
    advanceFrame();
    expect(onHtml).not.toHaveBeenCalled();
  });

  test('renderMarkdown produce HTML correcto', () => {
    streamer.push('**negrita** y *itálica*');
    advanceFrame();
    const html = onHtml.mock.calls[0][0];
    expect(html).toMatch(/<strong[^>]*>negrita<\/strong>/);
    expect(html).toMatch(/<em[^>]*>itálica<\/em>/);
  });
});

describe('reconcileDom', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
  });

  test('container vacío recibe el HTML completo con fade-in', () => {
    reconcileDom(container, '<p>Hola</p>');
    expect(container.children.length).toBe(1);
    expect(container.children[0].classList.contains('fade-in')).toBe(true);
    expect(container.innerHTML).toContain('Hola');
  });

  test('bloques idénticos se preservan sin fade-in', () => {
    container.innerHTML = '<p>Uno</p><p>Dos</p>';
    reconcileDom(container, '<p>Uno</p><p>Dos</p><p>Tres</p>');
    expect(container.children.length).toBe(3);
    expect(container.children[0].classList.contains('fade-in')).toBe(false);
    expect(container.children[1].classList.contains('fade-in')).toBe(false);
    expect(container.children[2].classList.contains('fade-in')).toBe(true);
  });

  test('último bloque mutable se reemplaza sin fade-in', () => {
    container.innerHTML = '<p>Texto en progreso</p>';
    reconcileDom(container, '<p>Texto en progreso que crece</p>');
    expect(container.children.length).toBe(1);
    expect(container.children[0].classList.contains('fade-in')).toBe(false);
    expect(container.textContent).toBe('Texto en progreso que crece');
  });

  test('bloque estable seguido de mutable funciona', () => {
    container.innerHTML = '<p>Estable</p><p>Mutable</p>';
    reconcileDom(container, '<p>Estable</p><p>Mutable creciendo</p>');
    expect(container.children.length).toBe(2);
    expect(container.children[0].classList.contains('fade-in')).toBe(false);
    expect(container.children[0].textContent).toBe('Estable');
    expect(container.children[1].classList.contains('fade-in')).toBe(false);
    expect(container.children[1].textContent).toBe('Mutable creciendo');
  });

  test('bloques sobran del lado viejo se eliminan', () => {
    container.innerHTML = '<p>Uno</p><p>Dos</p><p>Tres</p>';
    reconcileDom(container, '<p>Uno</p>');
    expect(container.children.length).toBe(1);
    expect(container.textContent).toBe('Uno');
  });

  test('tabla en progreso se reemplaza sin fade-in', () => {
    container.innerHTML = '<table><thead><tr><th>H1</th></tr></thead></table>';
    const newHtml = '<table><thead><tr><th>H1</th></tr></thead><tbody><tr><td>D1</td></tr></tbody></table>';
    reconcileDom(container, newHtml);
    expect(container.children.length).toBe(1);
    expect(container.children[0].tagName).toBe('TABLE');
    expect(container.children[0].classList.contains('fade-in')).toBe(false);
    expect(container.querySelector('td')?.textContent).toBe('D1');
  });

  test('fade-in en bloque nuevo más allá del count original', () => {
    container.innerHTML = '<p>Uno</p>';
    reconcileDom(container, '<p>Uno</p><p>Dos</p>');
    expect(container.children.length).toBe(2);
    expect(container.children[0].classList.contains('fade-in')).toBe(false);
    expect(container.children[1].classList.contains('fade-in')).toBe(true);
  });

  test('HTML vacío deja container vacío', () => {
    container.innerHTML = '<p>Something</p>';
    reconcileDom(container, '');
    expect(container.children.length).toBe(0);
  });

  test('delta: oración completada dentro del último bloque se anima', () => {
    container.innerHTML = '<p>Hola.</p>';
    // La segunda oración está completa (tiene texto después)
    reconcileDom(container, '<p>Hola. Soy un asistente. Te ayudo</p>');

    const spans = fadeInSpans(container);
    expect(spans.length).toBeGreaterThanOrEqual(1);
    // "Soy un asistente." es la oración completada (tiene " Te ayudo" después)
    expect(spans[0].textContent).toContain('Soy un asistente');
  });

  test('delta: última oración incompleta no se anima', () => {
    container.innerHTML = '<p>Hola.</p>';
    // "Soy un asistente" NO termina con . ! ? \n → sigue siendo pendiente
    reconcileDom(container, '<p>Hola. Soy un asistente</p>');
    // Debe tener un span.fade-in para "Soy un asistente"... wait, no.
    // " Soy un asistente" no termina con . ! ? \n. El texto después de "Hola."
    // es " Soy un asistente" que no tiene boundaries. Así que completedBoundaries
    // filter(b => b+1 < newText.length) → no hay boundaries en newText → 0.
    // Ergo: ningún span.fade-in dentro del bloque.
    const spans = fadeInSpans(container);
    expect(spans.length).toBe(0);
  });

  test('delta: múltiples oraciones completadas se animan juntas', () => {
    container.innerHTML = '<p>Inicio.</p>';
    // Dos oraciones completadas
    reconcileDom(container, '<p>Inicio. Primera. Segunda. Tercera</p>');

    const spans = fadeInSpans(container);
    expect(spans.length).toBeGreaterThanOrEqual(1);
    // Debería animar " Primera. Segunda." (ambas están completas, " Tercera" es pendiente)
    expect(spans[0].textContent).toContain('Primera');
    expect(spans[0].textContent).toContain('Segunda');
  });

  test('delta: texto sin boundaries no se anima', () => {
    container.innerHTML = '<p>Texto</p>';
    reconcileDom(container, '<p>Texto que sigue creciendo sin punto</p>');
    const spans = fadeInSpans(container);
    expect(spans.length).toBe(0);
  });

  test('delta: respeta inline syntax (no rompe bold)', () => {
    container.innerHTML = '<p><strong>Hola</strong></p>';
    // El delta son palabras nuevas sin boundaries
    reconcileDom(container, '<p><strong>Hola mundo</strong></p>');
    // El bold debe estar intacto
    expect(container.querySelector('strong')?.textContent).toBe('Hola mundo');
    const spans = fadeInSpans(container);
    expect(spans.length).toBe(0); // sin boundaries → sin fade-in
  });

  test('delta: oración completada dentro de bold se anima correctamente', () => {
    container.innerHTML = '<p><strong>Hola.</strong></p>';
    reconcileDom(container, '<p><strong>Hola. Nuevo texto.</strong> Final</p>');
    // " Nuevo texto." es oración completada → debe estar en fade-in
    const spans = fadeInSpans(container);
    expect(spans.length).toBeGreaterThanOrEqual(1);
    expect(spans[0].textContent).toContain('Nuevo texto');
  });
});
