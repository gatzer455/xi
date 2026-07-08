/**
 * tool-call-chip.ts — Chip individual de tool call (nivel 2 + 3).
 *
 * Nivel 2 (colapsado): muestra tool name + target (archivo, patrón, comando).
 * Nivel 3 (expandido): muestra arguments + resultado (si disponible).
 *
 * El chip no tiene indicadores de ✓/✗ en el header. Los resultados
 * se muestran inline en el body expandido, con color verde (éxito)
 * o rojo (error), como Claude Desktop.
 */

import type { ToolCallPart } from '../lib/chat/types.ts';
import { formatToolCallHeader } from '../lib/format-tool-call.ts';

/** Renderiza un chip individual de tool call.
 *
 *  @param tc ToolCallPart a renderizar (puede tener `result` mergeado)
 *  @param level 'compact' solo header, 'full' incluye body expandible
 */
export function ToolCallChip(
  tc: ToolCallPart,
  level: 'compact' | 'full' = 'full',
): HTMLElement {
  const chip = document.createElement('div');
  chip.className = 'tool-chip tool-call-chip';
  chip.dataset.toolCallId = tc.toolCallId;

  // Header
  const header = document.createElement('div');
  header.className = 'tool-chip-header';

  const label = document.createElement('span');
  label.className = 'tool-chip-label';
  label.textContent = formatToolCallHeader(tc);
  header.append(label);

  // Chevron (solo si level = 'full')
  if (level === 'full') {
    const chevron = document.createElement('span');
    chevron.className = 'tool-chip-chevron';
    chevron.textContent = '▸';
    header.append(chevron);

    chip.addEventListener('click', () => {
      const expanded = chip.classList.toggle('tool-chip--expanded');
      chevron.textContent = expanded ? '▾' : '▸';
      chip.setAttribute('aria-expanded', String(expanded));
    });

    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.setAttribute('aria-expanded', 'false');
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        chip.click();
      }
    });
  }

  chip.append(header);

  // Body (nivel 3): arguments + resultado en un solo <pre>
  if (level === 'full') {
    const body = document.createElement('div');
    body.className = 'tool-chip-body';

    let code = `Arguments:\n${JSON.stringify(tc.arguments, null, 2)}`;
    if (tc.result) {
      code += `\n\nResult:\n${tc.result.output}`;
    }

    const pre = document.createElement('pre');
    pre.className = 'tool-chip-detail';
    if (tc.result?.isError) {
      pre.classList.add('tool-chip-detail--error');
    }
    pre.textContent = code;
    body.append(pre);

    chip.append(body);
  }

  return chip;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
