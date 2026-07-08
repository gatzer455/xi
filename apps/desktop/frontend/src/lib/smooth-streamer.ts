/**
 * smooth-streamer.ts — Render progresivo de markdown estilo Gemini.
 *
 * Acumula el texto completo del LLM en un buffer. En vez de renderizar
 * cada frame (60fps), renderiza a una CADENCIA controlada (~200ms). Con
 * esa cadencia, cada render trae un delta del tamaño de una frase, y la
 * animación de fade-in (~180ms) alcanza a completarse ANTES de que el
 * siguiente render reemplace el bloque — el span animado ya llegó a su
 * estado final (opacidad 1), así que su reemplazo por HTML idéntico es
 * visualmente imperceptible.
 *
 * El buffer completo se renderiza a markdown cada vez (correcto: tablas,
 * LaTeX, code fences). reconcileDom() diffea el DOM: preserva bloques
 * estables, reemplaza el último bloque mutable y envuelve el delta de
 * texto nuevo en <span class="fade-in">. La cascada estilo Gemini emerge
 * de frames sucesivos: cada frame añade una nueva frase que hace fade-in.
 */

import { renderMarkdown, renderStreamingMarkdown } from './markdown.ts';

/** Cadencia de revelado por defecto (ms entre renders). */
let defaultIntervalMs = 200;

/**
 * Ajusta la cadencia de revelado por defecto para instancias que no pasan
 * `intervalMs` (ej: la que crea ChatBubble). Pensado como seam de test para
 * volver el streaming determinista con 0 (render por rAF).
 */
export function setRevealInterval(ms: number): void {
  defaultIntervalMs = ms;
}

export interface SmoothStreamerOptions {
  /**
   * Milisegundos mínimos entre renders. 0 = renderiza cada rAF (modo
   * legacy, útil en tests). El primer render siempre es inmediato.
   */
  intervalMs?: number;
}

export class SmoothStreamer {
  private buffer = '';
  private rafId: number | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private lastRender = -Infinity;
  private readonly intervalMs: number;

  private onHtml: (html: string) => void;

  constructor(onHtml: (html: string) => void, options: SmoothStreamerOptions = {}) {
    this.onHtml = onHtml;
    this.intervalMs = options.intervalMs ?? defaultIntervalMs;
  }

  push(chunk: string): void {
    if (this.disposed) return;
    this.buffer += chunk;
    this.schedule();
  }

  flush(): void {
    if (this.disposed) return;
    this.cancelPending();
    if (this.buffer.length > 0) {
      const html = renderMarkdown(this.buffer);
      if (html) this.onHtml(html);
      this.lastRender = now();
    }
  }

  reset(): void {
    this.cancelPending();
    this.buffer = '';
    this.disposed = false;
    this.lastRender = -Infinity;
  }

  dispose(): void {
    this.cancelPending();
    this.buffer = '';
    this.disposed = true;
  }

  private schedule(): void {
    if (this.rafId !== null || this.timerId !== null) return;
    const elapsed = now() - this.lastRender;
    if (elapsed >= this.intervalMs) {
      this.scheduleRaf();
    } else {
      this.timerId = setTimeout(() => {
        this.timerId = null;
        this.scheduleRaf();
      }, this.intervalMs - elapsed);
    }
  }

  private scheduleRaf(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.render();
    });
  }

  private cancelPending(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private render(): void {
    if (this.disposed || this.buffer.length === 0) return;
    // Render intermedio: repara sintaxis a medio formar (no flicker).
    const html = renderStreamingMarkdown(this.buffer);
    if (html) this.onHtml(html);
    this.lastRender = now();
  }
}

function now(): number {
  return performance.now();
}

// ─── DOM reconciliation ───────────────────────────────────

/**
 * Actualiza `container` con el nuevo HTML de markdown.
 *
 * - Bloques estables (mismo outerHTML) → preservados sin tocar.
 * - Nuevos bloques más allá del count original → `.fade-in` (bloque entero).
 * - Último bloque mutable reemplazado → el delta de texto nuevo se envuelve
 *   en `<span class="fade-in">` para que aparezca con animación.
 */
export function reconcileDom(container: HTMLElement, newHtml: string): void {
  const temp = document.createElement('div');
  temp.innerHTML = newHtml;

  const newKids = Array.from(temp.children);
  const oldKids = Array.from(container.children);
  const oldCount = oldKids.length;

  // 1. Prefijo de bloques estables (idénticos byte a byte)
  let stable = 0;
  for (; stable < Math.min(newKids.length, oldKids.length); stable++) {
    if (newKids[stable].outerHTML !== oldKids[stable].outerHTML) break;
  }

  // Guardar el texto del OLD bloque mutable antes de removerlo: marca
  // dónde empieza el delta a animar.
  const oldBlockText = stable < oldCount
    ? oldKids[stable].textContent || ''
    : '';
  const oldBlockLen = oldBlockText.length;

  // 2. Remover tail viejo (desde `stable` en adelante)
  while (container.children.length > stable) {
    container.lastElementChild?.remove();
  }

  // 3. Insertar tail nuevo
  for (let j = stable; j < newKids.length; j++) {
    const clone = newKids[j].cloneNode(true) as HTMLElement;
    if (j >= oldCount) {
      // Bloque genuinamente nuevo → fade-in del bloque entero.
      clone.classList.add('fade-in');
    }
    container.appendChild(clone);
  }

  // 4. Animar el delta de texto dentro del último bloque mutable.
  //
  // Solo animamos si el texto viejo es PREFIJO del nuevo (el bloque solo
  // creció por la cola). Si no lo es, el markdown re-formateó el tail
  // —típico al cerrar `**bold**`, `` `code` ``, `[links]()`, `#` o pipes
  // de tabla, que colapsan caracteres de sintaxis del textContent— y el
  // offset `oldBlockLen` ya no mapea al mismo lugar. Envolver igual re-
  // animaría texto ya visible (opacity 0 → flash) = flickering. En ese
  // caso saltamos la animación este frame; cuando la sintaxis se estabiliza,
  // el prefijo vuelve a cumplirse y el fade-in continúa.
  if (stable < oldCount && stable < newKids.length) {
    const block = container.children[stable] as HTMLElement;
    if (block && !block.classList.contains('fade-in')) {
      const newText = block.textContent || '';
      if (newText.length > oldBlockLen && newText.startsWith(oldBlockText)) {
        wrapDeltaRange(block, oldBlockLen, newText.length);
      }
    }
  }
}

// ─── Animación del delta de texto ─────────────────────────

/**
 * Envuelve el rango de texto plano [startChar, endChar) dentro de `el`
 * en `<span class="fade-in">`, un span por cada text node afectado.
 *
 * Trabaja sobre el TEXTO RENDERIZADO (text nodes del DOM), no sobre raw
 * markdown, así que es seguro: nunca rompe tablas, LaTeX ni code fences.
 * Envolver por text node (en vez de un único Range que cruza elementos)
 * garantiza que nunca se extrae estructura parcial de `<td>`/`<li>`/etc.
 */
function wrapDeltaRange(el: HTMLElement, startChar: number, endChar: number): void {
  if (startChar >= endChar) return;

  // Primero recolectamos los tramos a envolver (sin mutar todavía: mutar
  // durante el walk invalidaría los offsets acumulados).
  interface Target { node: Text; localStart: number; localEnd: number; }
  const targets: Target[] = [];

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const len = node.textContent?.length || 0;
    const nodeStart = acc;
    const nodeEnd = acc + len;
    acc = nodeEnd;

    const from = Math.max(nodeStart, startChar);
    const to = Math.min(nodeEnd, endChar);
    if (from < to) {
      targets.push({ node, localStart: from - nodeStart, localEnd: to - nodeStart });
    }
  }

  // Ahora mutamos. splitText corta el text node en el offset dado.
  for (const t of targets) {
    let textNode = t.node;
    if (t.localStart > 0) {
      textNode = textNode.splitText(t.localStart);
    }
    const wrapLen = t.localEnd - t.localStart;
    if ((textNode.textContent?.length || 0) > wrapLen) {
      textNode.splitText(wrapLen);
    }

    const span = document.createElement('span');
    span.className = 'fade-in';
    const parent = textNode.parentNode;
    if (parent) {
      parent.replaceChild(span, textNode);
      span.appendChild(textNode);
    }
  }
}
