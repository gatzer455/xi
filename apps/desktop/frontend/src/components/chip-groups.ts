/**
 * chip-groups.ts — Orquestadores de chips (ToolCallGroup + ToolChipGroup).
 *
 * Merge de tool-call-group.ts + tool-chip-group.ts.
 * ToolCallGroup agrupa tool calls bajo un resumen expandible.
 * ToolChipGroup decide la fase visual y renderiza ThinkingChip + ToolCallGroup.
 */

import type { ChatMessage, ThinkingPart, ToolCallPart, ToolGroupSummary } from '../lib/chat/types.ts';
import { extractText, groupToolCalls, passiveLabel } from '../lib/chat/mapping.ts';
import { ThinkingChip, ToolCallChip, toggleChip } from './chips.ts';

// ─── ToolCallGroup ────────────────────────────────────────

export function ToolCallGroup(groups: ToolGroupSummary[]): HTMLElement {
  const chip = document.createElement('div');
  chip.className = 'tool-chip tool-call-group';
  chip.setAttribute('role', 'button');
  chip.setAttribute('tabindex', '0');
  chip.setAttribute('aria-expanded', 'false');

  const header = document.createElement('div');
  header.className = 'tool-chip-header';
  const summary = document.createElement('span');
  summary.className = 'tool-chip-summary';
  summary.textContent = groups.map(g => `${passiveLabel(g.action)} ${g.count} ${pluralNoun(g.action, g.count)}`).join(', ');
  header.append(summary);
  const chevron = document.createElement('span');
  chevron.className = 'tool-chip-chevron';
  chevron.textContent = '▸';
  header.append(chevron);
  chip.append(header);

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

  chip.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.tool-call-chip')) return;
    const expanded = chip.classList.toggle('tool-chip--expanded');
    chevron.textContent = expanded ? '▾' : '▸';
    chip.setAttribute('aria-expanded', String(expanded));
  });
  chip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleChip(chip, chevron); }
  });
  return chip;
}

function pluralNoun(action: string, count: number): string {
  const m: Record<string, [string, string]> = {
    Editó: ['archivo', 'archivos'], Leyó: ['archivo', 'archivos'], Escribió: ['archivo', 'archivos'],
    Listó: ['directorio', 'directorios'], Ejecutó: ['comando', 'comandos'],
    Buscó: ['búsqueda', 'búsquedas'], Preguntó: ['vez', 'veces'],
    'Extrayó página': ['página', 'páginas'], 'Buscó en la web': ['búsqueda', 'búsquedas'],
    'Buscó código': ['búsqueda', 'búsquedas'],
  };
  const pair = m[action];
  return pair ? (count === 1 ? pair[0] : pair[1]) : count === 1 ? 'tool' : 'tools';
}

// ─── ToolChipGroup ────────────────────────────────────────

export type ChipPhase = 'inferencing' | 'writing' | 'done';

export function ToolChipGroup(msg: ChatMessage): HTMLElement | null {
  const thinkingParts = msg.parts.filter((p): p is ThinkingPart => p.type === 'thinking');
  const toolCallParts = msg.parts.filter((p): p is ToolCallPart => p.type === 'toolCall');
  const hasText = extractText(msg).length > 0;
  if (thinkingParts.length === 0 && toolCallParts.length === 0) return null;

  const phase = msg.isStreaming
    ? (thinkingParts.length > 0 || toolCallParts.some(tc => tc.state === 'pending' || tc.state === 'running') ? 'inferencing'
      : hasText || msg.isStreaming ? 'writing' : 'done')
    : 'done';

  const container = document.createElement('div');
  container.className = `tool-chip-group tool-chip-group--${phase}`;
  if (thinkingParts.length > 0) container.append(ThinkingChip(thinkingParts, { isStreaming: phase === 'inferencing' }));
  if (toolCallParts.length > 0) container.append(ToolCallGroup(groupToolCalls(toolCallParts)));
  return container;
}
