/**
 * smooth-streamer.ts — Render progresivo de markdown por oraciones.
 *
 * A diferencia del SmoothStreamer v1 (carácter-por-carácter), esta versión
 * extrae oraciones completas separadas por `. ! ? \n` y las renderiza
 * una por una con fade-in, como hace Gemini. El texto pendiente (oración
 * incompleta) se re-renderiza cada frame sin animación.
 *
 *   push(chunk) → buffer += chunk → schedule rAF
 *     → extractSentences(buffer) → onSentence(html) por cada una
 *     → onPending(html) para el tail incompleto
 *
 * Inspirado en:
 *   - Sentence-level reveal de Gemini/Claude
 *   - "Respetar inline syntax para no cortar dentro de ** ` ~~"
 *   - Chrome for Developers: "Best practices to render streamed LLM responses"
 */

import { renderMarkdown } from './markdown.ts';

export class SmoothStreamer {
  private buffer = '';
  private rafId: number | null = null;
  private cutIndex = 0;
  private disposed = false;

  private onSentence: (html: string) => void;
  private onPending: (html: string) => void;

  /**
   * @param onSentence Callback por cada oración COMPLETA (con fade-in).
   * @param onPending  Callback para el texto pendiente (sin animación).
   */
  constructor(
    onSentence: (html: string) => void,
    onPending: (html: string) => void,
  ) {
    this.onSentence = onSentence;
    this.onPending = onPending;
  }

  push(chunk: string): void {
    if (this.disposed) return;
    this.buffer += chunk;
    this.schedule();
  }

  flush(): void {
    if (this.disposed) return;
    this.cancelRaf();
    // Renderizar el tail pendiente como oración final (sin fade-in)
    if (this.buffer.length > this.cutIndex) {
      const tail = this.buffer.slice(this.cutIndex);
      const safe = closeInlineSyntax(tail);
      const html = renderMarkdown(safe);
      if (html) this.onPending(html);
      this.cutIndex = this.buffer.length;
    }
  }

  reset(): void {
    this.cancelRaf();
    this.buffer = '';
    this.cutIndex = 0;
    this.disposed = false;
  }

  dispose(): void {
    this.cancelRaf();
    this.buffer = '';
    this.cutIndex = 0;
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

    const newContent = this.buffer.slice(this.cutIndex);
    if (newContent.length === 0) return;

    const { sentences, pending } = splitSentences(newContent);

    // Cada oración completa → render + append con fade-in
    for (const sentence of sentences) {
      const safe = closeInlineSyntax(sentence);
      const html = renderMarkdown(safe);
      if (html) this.onSentence(html);
    }

    // Tail pendiente → re-renderizar cada frame sin animación
    if (pending.length > 0) {
      const safe = closeInlineSyntax(pending);
      const html = renderMarkdown(safe);
      this.onPending(html);
    }

    // Avanzar el corte: buffer.length - pending.length
    this.cutIndex = this.buffer.length - pending.length;
  }
}

// ─── Spliteo de oraciones ───────────────────────────────

interface SentenceResult {
  sentences: string[];
  pending: string;
}

/**
 * Divide texto en oraciones completas + tail pendiente.
 *
 * Una oración termina en `. ! ? \n`, pero solo cuando NO estamos
 * dentro de inline syntax (`**`, `~~) o code fence (```).
 *
 * Esto evita cortar dentro de `**bold**` o `` `code` `` cuando
 * el inline span contiene puntuación.
 */
function splitSentences(text: string): SentenceResult {
  if (!text) return { sentences: [], pending: '' };

  const sentences: string[] = [];
  let lastCut = 0;
  let inFence = false;
  let boldOpen = false;
  let strikeOpen = false;
  let linkOpen = false;

  const len = text.length;
  let i = 0;

  while (i < len) {
    // ── Code fence (```) ──
    if (i + 3 <= len && text.slice(i, i + 3) === '```') {
      inFence = !inFence;
      i += 3;
      continue;
    }

    if (inFence) { i++; continue; }

    // ── Bold (**) ──
    if (i + 2 <= len && text.slice(i, i + 2) === '**') {
      boldOpen = !boldOpen;
      i += 2;
      continue;
    }

    // ── Strikethrough (~~) ──
    if (i + 2 <= len && text.slice(i, i + 2) === '~~') {
      strikeOpen = !strikeOpen;
      i += 2;
      continue;
    }

    // ── Link bracket balance ──
    if (text[i] === '[' && !linkOpen) {
      linkOpen = true;
      i++;
      continue;
    }
    if (text[i] === ']' && linkOpen) {
      linkOpen = false;
      i++;
      continue;
    }

    // ── Sentence-ending punctuation (solo si no estamos dentro de inline) ──
    if (!boldOpen && !strikeOpen && !linkOpen) {
      const ch = text[i];

      // . ! ? seguido de espacio, newline, o fin de string
      if ((ch === '.' || ch === '!' || ch === '?') &&
          (i + 1 >= len || text[i + 1] === ' ' || text[i + 1] === '\n')) {
        const end = i + 1; // incluir la puntuación
        sentences.push(text.slice(lastCut, end));
        lastCut = end;
        i++;
        continue;
      }

      // \n también es boundary de oración
      if (ch === '\n') {
        const end = i + 1;
        sentences.push(text.slice(lastCut, end));
        lastCut = end;
        i++;
        continue;
      }
    }

    i++;
  }

  const pending = text.slice(lastCut);
  return { sentences, pending };
}

// ─── Cierre especulativo de inline syntax ────────────────

function closeInlineSyntax(text: string): string {
  let result = text;
  const trimmed = result.trimEnd();
  if (!trimmed) return result;

  if (countOccurrences(trimmed, '**') % 2 !== 0) {
    result = result.trimEnd() + '**';
  }

  const withoutBold = trimmed.replace(/\*\*/g, '');
  if (countOccurrences(withoutBold, '*') % 2 !== 0) {
    result = result.trimEnd() + '*';
  }

  if (countOccurrences(trimmed, '`') % 2 !== 0) {
    result = result.trimEnd() + '`';
  }

  if (countOccurrences(trimmed, '~~') % 2 !== 0) {
    result = result.trimEnd() + '~~';
  }

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

export { closeInlineSyntax, splitSentences };
