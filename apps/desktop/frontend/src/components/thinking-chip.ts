/**
 * thinking-chip.ts — Chip de razonamiento (ThinkingChip).
 *
 * Colapsado: "Pensando..." con puntos animados (CSS, sin JS),
 *            o "Se pensó Xs" cuando terminó.
 * Expandido: texto COMPLETO del razonamiento renderizado como markdown.
 *
 * Sin indicador visual (ni braille, ni ■). Solo texto.
 * El braille spinner vive únicamente en la context bar (pi branding).
 */

import type { ThinkingPart } from '../lib/chat/types.ts';
import { renderMarkdown } from '../lib/markdown.ts';

/** Renderiza el chip de razonamiento.
 *
 *  @param parts Array de ThinkingPart con el texto del razonamiento
 *  @param opts.isStreaming true si el modelo está aún pensando
 *  @returns Elemento HTMLElement del chip
 */
export function ThinkingChip(
  parts: ThinkingPart[],
  opts: { isStreaming?: boolean } = {},
): HTMLElement {
  const chip = document.createElement('div');
  chip.className = 'tool-chip thinking-chip';
  chip.setAttribute('role', 'button');
  chip.setAttribute('tabindex', '0');
  chip.setAttribute('aria-expanded', 'false');

  // Header: sin status dot, solo label con puntos animados
  const header = document.createElement('div');
  header.className = 'tool-chip-header';

  const label = document.createElement('span');
  label.className = 'tool-chip-label';

  if (opts.isStreaming) {
    // "Pensando" con puntos animados vía CSS
    label.textContent = 'Pensando';
    const dots = document.createElement('span');
    dots.className = 'thinking-dots-anim';
    label.append(dots);
  } else {
    const elapsed = estimateElapsed(parts);
    label.textContent = `Se pensó ${elapsed}`;
  }
  header.append(label);

  // Chevron
  const chevron = document.createElement('span');
  chevron.className = 'tool-chip-chevron';
  chevron.textContent = '▸';
  header.append(chevron);

  chip.append(header);

  // Body: texto completo del razonamiento renderizado como markdown
  const body = document.createElement('div');
  body.className = 'tool-chip-body';
  const fullText = parts.map(p => p.text).join('\n\n');
  body.innerHTML = renderMarkdown(fullText);
  chip.append(body);

  // Toggle
  function toggle() {
    const expanded = chip.classList.toggle('tool-chip--expanded');
    chevron.textContent = expanded ? '▾' : '▸';
    chip.setAttribute('aria-expanded', String(expanded));
  }

  chip.addEventListener('click', toggle);
  chip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });

  return chip;
}

/** Estima el tiempo transcurrido en segundos basado en la longitud
 *  del razonamiento. Como no tenemos timestamp real, usamos una
 *  heurística. */
function estimateElapsed(parts: ThinkingPart[]): string {
  const totalChars = parts.reduce((acc, p) => acc + p.text.length, 0);
  const seconds = Math.max(1, Math.round(totalChars / 50));
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}m ${sec}s`;
}
