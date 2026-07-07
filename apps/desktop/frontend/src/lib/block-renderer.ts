/**
 * block-renderer.ts — Render progresivo de markdown por bloques.
 *
 * A diferencia del StreamBuffer (que revela caracteres como texto plano),
 * BlockRenderer acumula texto de un stream LLM, detecta bloques semánticos
 * completos (párrafos, headings, code fences, listas) y los renderiza como
 * HTML markdown apenas se completan, insertándolos incrementalmente en el DOM
 * sin tocar los bloques ya renderizados.
 *
 * Inspirado en:
 *   - Streamdown (Vercel): remend + block memoization
 *   - Generative DOM: AST diff + DOM patching sin innerHTML
 *   - Flowdown: state machine O(1), sin AST intermedio
 *   - markdown-streaming: cierre especulativo de inline parcial
 */

import { renderMarkdown } from './markdown.ts';

export interface BlockRendererOptions {
  /** Callback cuando un bloque nuevo se inserta en el DOM. */
  onBlock?: (blockEl: HTMLElement) => void;
  /** Callback cuando flush() termina. */
  onDone?: () => void;
  /** Callback cuando cambia el texto pendiente (para cursor). */
  onPending?: (hasPending: boolean) => void;
}

export class BlockRenderer {
  private buffer = '';
  private container: HTMLElement;
  private opts: BlockRendererOptions;
  private isDisposed = false;

  constructor(container: HTMLElement, opts: BlockRendererOptions = {}) {
    this.container = container;
    this.opts = opts;
  }

  /** ¿Hay texto pendiente sin renderizar? */
  get hasPending(): boolean {
    return this.buffer.length > 0;
  }

  /**
   * Empuja un chunk de texto del stream. Detecta bloques completos,
   * los renderiza como markdown y los inserta en el DOM. El texto
   * que no forma un bloque completo se acumula para el próximo push.
   */
  push(chunk: string): void {
    if (this.isDisposed) return;
    this.buffer += chunk;

    const { completed, pending } = extractCompletedBlocks(this.buffer);

    if (completed.length > 0) {
      // Cerrar inline syntax incompleto en el bloque para que
      // markdown-it no muestre **crudo.
      const safe = closeInlineSyntax(completed);

      const html = renderMarkdown(safe);
      if (html) {
        const wrapper = document.createElement('div');
        wrapper.className = 'md-block block-appear';
        wrapper.innerHTML = html;
        this.container.appendChild(wrapper);
        this.opts.onBlock?.(wrapper);
      }

      this.buffer = pending;
    }

    this.opts.onPending?.(this.buffer.length > 0);
  }

  /**
   * Fuerza el render del bloque pendiente. Se llama cuando el
   * stream termina (agent_end). Si no hay pending, es no-op.
   */
  flush(): void {
    if (this.isDisposed) return;

    if (this.buffer.trim().length > 0) {
      const safe = closeInlineSyntax(this.buffer);
      const html = renderMarkdown(safe);
      if (html) {
        const wrapper = document.createElement('div');
        wrapper.className = 'md-block';
        wrapper.innerHTML = html;
        this.container.appendChild(wrapper);
        this.opts.onBlock?.(wrapper);
      }
    }

    this.buffer = '';
    this.opts.onPending?.(false);
    this.opts.onDone?.();
  }

  /** Limpia el estado interno. No toca el DOM. */
  reset(): void {
    this.buffer = '';
    this.isDisposed = false;
    this.opts.onPending?.(false);
  }

  /** Libera recursos. Después de dispose(), push/flush son no-op. */
  dispose(): void {
    this.isDisposed = true;
    this.buffer = '';
    this.opts.onPending?.(false);
  }
}

// ─── Detección de bloques completos ──────────────────────

interface ExtractionResult {
  completed: string;
  pending: string;
}

/**
 * Divide el buffer en "bloques completos" y "bloque pendiente".
 *
 * Algoritmo:
 *   Recorremos línea por línea. Una línea vacía fuera de un code fence
 *   marca el fin del bloque anterior. El corte se hace justo antes del
 *   primer `\n` del separador (es decir, al final del contenido visible).
 *
 *   Code fences (```) se respetan: no cortamos dentro de ellos.
 */
function extractCompletedBlocks(text: string): ExtractionResult {
  if (!text) return { completed: '', pending: '' };

  const lines = text.split('\n');
  let inFence = false;
  /** Posición del carácter donde empieza cada línea. */
  const lineStarts: number[] = [];

  // Calcular posición de inicio de cada línea
  {
    let pos = 0;
    for (let i = 0; i < lines.length; i++) {
      lineStarts.push(pos);
      pos += lines[i].length + 1; // +1 por el \n
    }
  }

  let lastCut = 0; // índice del último corte estable

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    // Code fence toggle
    if (trimmed.startsWith('```')) {
      if (!inFence) {
        inFence = true;
      } else {
        inFence = false;
        // Al cerrar un fence, cortamos justo después del \n de cierre.
        lastCut = lineStarts[i] + lines[i].length + 1;
      }
      continue;
    }

    if (inFence) continue;

    // Línea vacía → fin del bloque anterior.
    // Cortamos justo antes del primer \n del separador (\n\n).
    // Es decir, al final de la línea con contenido visible.
    if (trimmed === '' && i > 0 && lines[i - 1].trim() !== '') {
      // lineStarts[i] apunta al primer char de la línea vacía.
      // Queremos cortar justo ANTES de esa posición = fin de línea i-1.
      lastCut = lineStarts[i] > 0 ? lineStarts[i] - 1 : 0;
    }
  }

  // Ajustar lastCut para que no exceda el texto
  if (lastCut >= text.length) lastCut = text.length;
  // No cortar en whitespace puro al final
  if (lastCut > 0 && text.slice(lastCut).trim() === '') {
    lastCut = text.length;
  }

  // Si no hay corte significativo, todo es pending
  if (lastCut === 0) {
    return { completed: '', pending: text };
  }

  const completed = text.slice(0, lastCut).trimEnd();
  const pending = text.slice(lastCut);

  return { completed, pending };
}

// ─── Cierre especulativo de inline syntax ────────────────

/**
 * Cierra temporalmente constructs inline incompletos al final del
 * bloque pendiente. Inspirado en `remend` (Streamdown) y
 * `markdown-streaming`.
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

export { extractCompletedBlocks, closeInlineSyntax };
