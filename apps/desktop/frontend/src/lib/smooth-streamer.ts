/**
 * smooth-streamer.ts — Render progresivo de markdown por frames.
 *
 * A diferencia del BlockRenderer (que espera bloques completos con \n\n),
 * SmoothStreamer renderiza el buffer completo en cada requestAnimationFrame:
 *
 *   push(chunk) → buffer += chunk → schedule rAF → onHtml(renderMarkdown(buffer))
 *
 * Esto produce una revelación suave carácter-por-carácter como Gemini/Claude,
 * en vez de saltos por bloques. El parseo de markdown se hace sobre el texto
 * completo, que para respuestas típicas (<10 KB) toma <5 ms — dentro del
 * presupuesto de 16 ms por frame.
 *
 * Inspirado en:
 *   - "Streaming Tokens Without Layout Thrash" (anmshpndy.com)
 *   - Generative DOM: rAF-batched DOM updates
 *   - Coder/coder: SmoothText engine + typewriter reveal
 *   - Chrome for Developers: "Best practices to render streamed LLM responses"
 */

import { renderMarkdown } from './markdown.ts';

export class SmoothStreamer {
  private buffer = '';
  private rafId: number | null = null;
  private onHtml: (html: string) => void;
  private disposed = false;

  /**
   * @param onHtml Callback que recibe el HTML renderizado cada frame.
   *               El caller hace `container.innerHTML = html`.
   */
  constructor(onHtml: (html: string) => void) {
    this.onHtml = onHtml;
  }

  /**
   * Acumula texto y agenda un render en el próximo frame.
   * Múltiples llamadas consecutivas coalescen en un solo rAF.
   */
  push(chunk: string): void {
    if (this.disposed) return;
    this.buffer += chunk;
    this.schedule();
  }

  /**
   * Renderiza inmediatamente (cancela el rAF pendiente).
   * Usar cuando el stream termina: garantiza que el último carácter
   * esté en pantalla sin esperar al siguiente frame.
   */
  flush(): void {
    if (this.disposed) return;
    this.cancelRaf();
    this.render();
  }

  /** Limpia el estado interno. No toca el DOM. */
  reset(): void {
    this.cancelRaf();
    this.buffer = '';
    this.disposed = false;
  }

  /** Libera recursos. push/flush son no-op después de dispose. */
  dispose(): void {
    this.cancelRaf();
    this.buffer = '';
    this.disposed = true;
  }

  // ─── internals ──────────────────────────────────────────

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
    const safe = closeInlineSyntax(this.buffer);
    const html = renderMarkdown(safe);
    if (html) {
      this.onHtml(html);
    }
  }
}

// ─── Cierre especulativo de inline syntax ────────────────

/**
 * Cierra temporalmente constructs inline incompletos al final del
 * buffer para que markdown-it no muestre `**crudo`.
 *
 * Sin esto, `**texto en negrita` se mostraría como literal `**texto...`
 * en vez de renderizarse como bold (aunque incompleto).
 */
function closeInlineSyntax(text: string): string {
  let result = text;
  const trimmed = result.trimEnd();
  if (!trimmed) return result;

  // Bold (**)
  if (countOccurrences(trimmed, '**') % 2 !== 0) {
    result = result.trimEnd() + '**';
  }

  // Italic (*) sin confundir con bold
  const withoutBold = trimmed.replace(/\*\*/g, '');
  if (countOccurrences(withoutBold, '*') % 2 !== 0) {
    result = result.trimEnd() + '*';
  }

  // Inline code (`)
  if (countOccurrences(trimmed, '`') % 2 !== 0) {
    result = result.trimEnd() + '`';
  }

  // Strikethrough (~~)
  if (countOccurrences(trimmed, '~~') % 2 !== 0) {
    result = result.trimEnd() + '~~';
  }

  // Links: [sin cerrar] → [sin cerrar]()
  const openBracket = countOccurrences(trimmed, '[');
  const closeBracket = countOccurrences(trimmed, ']');
  if (openBracket > closeBracket) {
    const lastOpen = trimmed.lastIndexOf('[');
    const lastClosed = trimmed.lastIndexOf(']');
    if (lastOpen > lastClosed) {
      result = result.trimEnd() + ']()';
    }
  }

  return result;
}

function countOccurrences(str: string, substr: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(substr, pos)) !== -1) {
    count++;
    pos += substr.length;
  }
  return count;
}

// ─── Helpers exportados para testing ─────────────────────

export { closeInlineSyntax };
