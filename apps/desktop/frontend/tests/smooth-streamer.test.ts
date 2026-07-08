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
    // intervalMs: 0 → renderiza cada rAF (modo legacy) para estos tests
    // de coalescing. El throttle se prueba aparte con fake timers.
    streamer = new SmoothStreamer(onHtml, { intervalMs: 0 });
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

  test('delta: el texto nuevo del bloque mutable se envuelve en fade-in', () => {
    container.innerHTML = '<p>Hola.</p>';
    reconcileDom(container, '<p>Hola. Soy un asistente. Te ayudo</p>');

    const spans = fadeInSpans(container);
    expect(spans.length).toBeGreaterThanOrEqual(1);
    // Se anima TODO el delta (sin importar boundaries de oración).
    const animated = spans.map((s) => s.textContent).join('');
    expect(animated).toBe(' Soy un asistente. Te ayudo');
    // El texto viejo NO se re-anima.
    expect(container.textContent).toBe('Hola. Soy un asistente. Te ayudo');
  });

  test('delta: texto sin puntuación también se anima (todo el delta)', () => {
    container.innerHTML = '<p>Texto</p>';
    reconcileDom(container, '<p>Texto que sigue creciendo sin punto</p>');
    const spans = fadeInSpans(container);
    expect(spans.length).toBeGreaterThanOrEqual(1);
    expect(spans.map((s) => s.textContent).join('')).toBe(' que sigue creciendo sin punto');
  });

  test('delta: no re-anima si el bloque no creció', () => {
    container.innerHTML = '<p>Estable</p>';
    reconcileDom(container, '<p>Estable</p>');
    expect(fadeInSpans(container).length).toBe(0);
  });

  test('delta: respeta inline syntax (no rompe bold)', () => {
    container.innerHTML = '<p><strong>Hola</strong></p>';
    reconcileDom(container, '<p><strong>Hola mundo</strong></p>');
    // El bold sigue intacto: el span vive DENTRO del <strong>.
    expect(container.querySelector('strong')?.textContent).toBe('Hola mundo');
    const spans = fadeInSpans(container);
    expect(spans.length).toBe(1);
    expect(spans[0].textContent).toBe(' mundo');
    expect(spans[0].closest('strong')).not.toBeNull();
  });

  test('delta: no anima (ni flickea) cuando el markdown re-formatea el tail', () => {
    // El viejo tenía `**negr` literal (los ** visibles como texto).
    container.innerHTML = '<p>Hola **negr</p>';
    // Al cerrarse el bold, `**` desaparecen del textContent → el viejo
    // "Hola **negr" ya NO es prefijo de "Hola negrita".
    reconcileDom(container, '<p>Hola <strong>negrita</strong></p>');
    // No debe re-envolver texto ya visible en spans opacity:0 (eso flickea).
    expect(fadeInSpans(container).length).toBe(0);
    // Y el contenido queda correcto.
    expect(container.querySelector('strong')?.textContent).toBe('negrita');
    expect(container.textContent).toBe('Hola negrita');
  });

  test('delta: cruza inline elements → un span por text node, sin romper estructura', () => {
    container.innerHTML = '<p>Hola </p>';
    // El delta cruza texto plano + un <strong>.
    reconcileDom(container, '<p>Hola mundo <strong>fuerte</strong></p>');
    // Estructura íntegra: el <strong> sigue siendo hijo del <p>.
    expect(container.querySelector('strong')?.textContent).toBe('fuerte');
    const spans = fadeInSpans(container);
    expect(spans.length).toBeGreaterThanOrEqual(1);
    expect(spans.map((s) => s.textContent).join('')).toBe('mundo fuerte');
  });
});

describe('SmoothStreamer throttle', () => {
  let onHtml: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onHtml = vi.fn();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      // rAF inmediato bajo fake timers: ejecuta el callback en microtask.
      return setTimeout(() => cb(performance.now()), 0) as unknown as number;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test('el primer push renderiza de inmediato', () => {
    const s = new SmoothStreamer(onHtml, { intervalMs: 200 });
    s.push('Hola');
    vi.advanceTimersByTime(1); // deja correr el rAF inmediato
    expect(onHtml).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  test('pushes seguidos coalescen hasta el próximo intervalo', () => {
    const s = new SmoothStreamer(onHtml, { intervalMs: 200 });
    s.push('a');
    vi.advanceTimersByTime(1);
    expect(onHtml).toHaveBeenCalledTimes(1); // render inmediato inicial

    // Estos caen dentro del intervalo → un solo render diferido.
    s.push('b');
    s.push('c');
    vi.advanceTimersByTime(50);
    expect(onHtml).toHaveBeenCalledTimes(1); // aún no pasa el intervalo

    vi.advanceTimersByTime(200);
    expect(onHtml).toHaveBeenCalledTimes(2); // render coalescido con "abc"
    expect(onHtml.mock.calls[1][0]).toContain('abc');
    s.dispose();
  });

  test('flush cancela el timer pendiente y renderiza ya', () => {
    const s = new SmoothStreamer(onHtml, { intervalMs: 200 });
    s.push('uno');
    vi.advanceTimersByTime(1);
    onHtml.mockClear();

    s.push(' dos'); // agenda un timer diferido
    s.flush();
    expect(onHtml).toHaveBeenCalledTimes(1);
    expect(onHtml.mock.calls[0][0]).toContain('uno dos');

    // El timer diferido ya no debe disparar otro render.
    vi.advanceTimersByTime(500);
    expect(onHtml).toHaveBeenCalledTimes(1);
  });
});
