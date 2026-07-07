/**
 * smooth-streamer.ts — Render progresivo de markdown con DOM reconciliation.
 *
 * Acumula el texto completo del LLM en un buffer. En cada rAF renderiza
 * el buffer completo a markdown (correcto: tablas, LaTeX, code fences).
 * Luego, reconcileDom() diffea el DOM: preserva bloques estables,
 * reemplaza el último bloque mutable, y anima el delta de texto.
 *
 * El fade-in se aplica a:
 *   - Bloques GENUINAMENTE NUEVOS (separados por \n\n en el markdown)
 *   - ORACIONES COMPLETADAS dentro del último bloque mutable,
 *     detectadas por . ! ? \n en el texto RENDERIZADO (no raw markdown)
 *
 * Inspirado en Chrome Developers "Best practices to render streamed
 * LLM responses" y Generative DOM / incremark-renderer / StreamMD.
 */

import { renderMarkdown } from './markdown.ts';

export class SmoothStreamer {
  private buffer = '';
  private rafId: number | null = null;
  private disposed = false;

  private onHtml: (html: string) => void;

  constructor(onHtml: (html: string) => void) {
    this.onHtml = onHtml;
  }

  push(chunk: string): void {
    if (this.disposed) return;
    this.buffer += chunk;
    this.schedule();
  }

  flush(): void {
    if (this.disposed) return;
    this.cancelRaf();
    if (this.buffer.length > 0) {
      const html = renderMarkdown(this.buffer);
      if (html) this.onHtml(html);
    }
  }

  reset(): void {
    this.cancelRaf();
    this.buffer = '';
    this.disposed = false;
  }

  dispose(): void {
    this.cancelRaf();
    this.buffer = '';
    this.disposed = true;
  }

  private schedule(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.render();
    });
  }

  private cancelRaf(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private render(): void {
    if (this.disposed || this.buffer.length === 0) return;
    const html = renderMarkdown(this.buffer);
    if (html) this.onHtml(html);
  }
}

// ─── DOM reconciliation ───────────────────────────────────

/**
 * Actualiza `container` con el nuevo HTML de markdown.
 *
 * - Bloques estables (mismo outerHTML) → preservados
 * - Nuevos bloques más allá del count original → `.fade-in`
 * - Último bloque mutable reemplazado → anima el delta de texto
 *   (oraciones completadas dentro del bloque)
 */
export function reconcileDom(container: HTMLElement, newHtml: string): void {
  const prevTextLen = container.textContent?.length || 0;

  const temp = document.createElement('div');
  temp.innerHTML = newHtml;

  const newKids = Array.from(temp.children);
  const oldKids = Array.from(container.children);
  const oldCount = oldKids.length;

  // 1. Prefijo de bloques estables
  let stable = 0;
  for (; stable < Math.min(newKids.length, oldKids.length); stable++) {
    const nk = newKids[stable];
    const ok = oldKids[stable];
    if (nk.outerHTML === ok.outerHTML) continue;
    if (nk.tagName === ok.tagName) break;
    break;
  }

  // 2. Remover tail viejo
  while (container.children.length > stable) {
    const last = container.lastElementChild;
    if (last) last.remove();
  }

  // Guardar largo del texto del OLD bloque mutable antes de perderlo
  const oldBlockLen = stable < oldCount
    ? oldKids[stable].textContent?.length || 0
    : 0;

  // 3. Insertar tail nuevo
  for (let j = stable; j < newKids.length; j++) {
    const clone = newKids[j].cloneNode(true) as HTMLElement;
    if (j >= oldCount) {
      clone.classList.add('fade-in');
    }
    container.appendChild(clone);
  }

  // 4. Animar delta de texto dentro del último bloque mutable
  if (stable < oldCount && stable < newKids.length) {
    const newBlock = container.children[stable] as HTMLElement;
    if (newBlock && !newBlock.classList.contains('fade-in')) {
      animateLastBlockDelta(newBlock, oldBlockLen);
    }
  }
}

// ─── Animación del delta de texto ─────────────────────────

/**
 * Dentro de `block` (ej: <p>), envuelve las oraciones completadas
 * (más allá de `oldBlockLen`) en `<span class="fade-in">`.
 *
 * Detecta boundaries de oración en el TEXTO RENDERIZADO
 * (textContent, no raw markdown), así que es seguro — no rompe
 * tablas, LaTeX ni code fences.
 *
 * La última oración (potencialmente incompleta) NO se anima.
 */
function animateLastBlockDelta(block: HTMLElement, oldBlockLen: number): void {
  const fullText = block.textContent || '';
  if (fullText.length <= oldBlockLen) return;

  // El texto nuevo dentro de este bloque
  const newText = fullText.slice(oldBlockLen);

  // Encontrar oraciones completadas (que tienen contenido después)
  const boundaries = findSentenceBoundaries(newText);
  const completed = boundaries.filter(b => b + 1 < newText.length);
  if (completed.length === 0) return;

  // La última oración completada
  const lastComplete = completed[completed.length - 1];
  // Hasta dónde animar (incluyendo la puntuación)
  const animateEnd = oldBlockLen + lastComplete + 1;

  if (animateEnd <= oldBlockLen) return;

  // Envolver el rango de texto en .fade-in
  wrapTextRange(block, oldBlockLen, animateEnd);
}

/**
 * Encuentra posiciones de boundaries de oración (. ! ? \n)
 * en texto plano (rendered textContent). Seguro porque no opera
 * sobre raw markdown.
 */
function findSentenceBoundaries(text: string): number[] {
  const boundaries: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '.' || ch === '!' || ch === '?' || ch === '\n') {
      // Debe ir seguido de espacio, newline o fin de string
      const isEnd = i + 1 >= text.length;
      const nextCh = isEnd ? '' : text[i + 1];
      if (isEnd || nextCh === ' ' || nextCh === '\n') {
        boundaries.push(i);
      }
    }
  }
  return boundaries;
}

/**
 * Envuelve el rango de texto [startChar, endChar) dentro de `el`
 * en un `<span class="fade-in">`.
 *
 * Usa Range + extractContents para manejar correctamente rangos
 * que crucen inline elements (bold, italic, code).
 */
function wrapTextRange(el: HTMLElement, startChar: number, endChar: number): void {
  if (startChar >= endChar) return;

  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);

  let accumulated = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  let foundEnd = false;

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const len = node.textContent?.length || 0;
    const nodeStart = accumulated;
    const nodeEnd = accumulated + len;

    if (startNode === null && nodeEnd > startChar) {
      startNode = node;
      startOffset = startChar - nodeStart;
    }

    if (!foundEnd && nodeEnd >= endChar) {
      endNode = node;
      endOffset = endChar - nodeStart;
      foundEnd = true;
      break;
    }

    accumulated += len;
  }

  if (!startNode || !endNode) return;

  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);

  // extractContents + insertNode funciona incluso cruzando
  // elementos inline, a diferencia de surroundContents
  const fragment = range.extractContents();
  const span = document.createElement('span');
  span.className = 'fade-in';
  span.appendChild(fragment);
  range.insertNode(span);
}
