/**
 * tool-call-group.ts — Agrupación de tool calls (nivel 1).
 *
 * Muestra un resumen colapsado tipo "Se editaron 2 archivos, se leyeron 3 archivos".
 * Al click, expande para mostrar los ToolCallChip individuales.
 */

import type { ToolGroupSummary } from '../lib/chat/types.ts';
import { passiveLabel } from '../lib/chat/mapping.ts';
import { ToolCallChip } from './tool-call-chip.ts';

/** Renderiza un grupo colapsable de tool calls.
 *
 *  @param groups Array de ToolGroupSummary (agrupados por acción)
 *  @returns Elemento HTMLElement del grupo
 */
export function ToolCallGroup(groups: ToolGroupSummary[]): HTMLElement {
  const chip = document.createElement('div');
  chip.className = 'tool-chip tool-call-group';
  chip.setAttribute('role', 'button');
  chip.setAttribute('tabindex', '0');
  chip.setAttribute('aria-expanded', 'false');

  // Header: resumen colapsado
  const header = document.createElement('div');
  header.className = 'tool-chip-header';

  const summary = document.createElement('span');
  summary.className = 'tool-chip-summary';
  summary.textContent = buildSummaryText(groups);
  header.append(summary);

  const chevron = document.createElement('span');
  chevron.className = 'tool-chip-chevron';
  chevron.textContent = '▸';
  header.append(chevron);

  chip.append(header);

  // Body: lista de tool calls individuales
  const body = document.createElement('div');
  body.className = 'tool-chip-body';
  body.dataset.testid = 'tool-chip-body';

  for (const group of groups) {
    for (const tc of group.tools) {
      const item = document.createElement('div');
      item.className = 'tool-chip-group-item';
      item.append(ToolCallChip(tc, 'full'));
      body.append(item);
    }
  }
  chip.append(body);

  // Toggle collapse/expand
  function toggle() {
    const expanded = chip.classList.toggle('tool-chip--expanded');
    chevron.textContent = expanded ? '▾' : '▸';
    chip.setAttribute('aria-expanded', String(expanded));
  }

  chip.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.tool-call-chip')) return;
    toggle();
  });

  chip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });

  return chip;
}

/** Construye el texto de resumen en voz pasiva:
 *  "Se editó 1 archivo, se leyeron 3 archivos" */
function buildSummaryText(groups: ToolGroupSummary[]): string {
  return groups.map(g => {
    const verb = passiveLabel(g.action);
    const noun = pluralNoun(g.action, g.count);
    return `${verb} ${g.count} ${noun}`;
  }).join(', ');
}

/** Plural de cada sustantivo según la acción. */
function pluralNoun(action: string, count: number): string {
  const nounMap: Record<string, [string, string]> = {
    Editó: ['archivo', 'archivos'],
    Leyó: ['archivo', 'archivos'],
    Escribió: ['archivo', 'archivos'],
    Listó: ['directorio', 'directorios'],
    Ejecutó: ['comando', 'comandos'],
    Buscó: ['búsqueda', 'búsquedas'],
    Preguntó: ['vez', 'veces'],
    'Extrayó página': ['página', 'páginas'],
    'Buscó en la web': ['búsqueda', 'búsquedas'],
    'Buscó código': ['búsqueda', 'búsquedas'],
  };

  const pair = nounMap[action];
  if (pair) return count === 1 ? pair[0] : pair[1];

  return count === 1 ? 'tool' : 'tools';
}
