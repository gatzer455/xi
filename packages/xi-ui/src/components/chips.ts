/**
 * chips.ts — Chips individuales (ThinkingChip + ToolCallChip).
 *
 * Merge de thinking-chip.ts + tool-call-chip.ts (ambos son chips
 * individuales con toggle collapse/expand).
 */

import type { ThinkingPart, ToolCallPart } from '../lib/chat/types.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { formatToolCallHeader } from '../lib/format-tool-call.ts';

// ─── ThinkingChip ─────────────────────────────────────────

export function ThinkingChip(parts: ThinkingPart[], opts: { isStreaming?: boolean } = {}): HTMLElement {
  const chip = document.createElement('div');
  chip.className = 'tool-chip thinking-chip';
  chip.setAttribute('role', 'button');
  chip.setAttribute('tabindex', '0');
  chip.setAttribute('aria-expanded', 'false');

  const header = document.createElement('div');
  header.className = 'tool-chip-header';

  const label = document.createElement('span');
  label.className = 'tool-chip-label';
  if (opts.isStreaming) {
    label.textContent = 'Pensando';
    const dots = document.createElement('span');
    dots.className = 'thinking-dots-anim';
    label.append(dots);
  } else {
    label.textContent = `Se pensó ${estimateElapsed(parts)}`;
  }
  header.append(label);

  const chevron = document.createElement('span');
  chevron.className = 'tool-chip-chevron';
  chevron.textContent = '▸';
  header.append(chevron);
  chip.append(header);

  const body = document.createElement('div');
  body.className = 'tool-chip-body';
  body.innerHTML = renderMarkdown(parts.map(p => p.text).join('\n\n'));
  chip.append(body);

  chip.addEventListener('click', () => toggleChip(chip, chevron));
  chip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleChip(chip, chevron); }
  });
  return chip;
}

function estimateElapsed(parts: ThinkingPart[]): string {
  const totalChars = parts.reduce((acc, p) => acc + p.text.length, 0);
  const seconds = Math.max(1, Math.round(totalChars / 50));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// ─── ToolCallChip ─────────────────────────────────────────

export function ToolCallChip(tc: ToolCallPart, level: 'compact' | 'full' = 'full'): HTMLElement {
  const chip = document.createElement('div');
  chip.className = 'tool-chip tool-call-chip';
  chip.dataset.toolCallId = tc.toolCallId;

  const header = document.createElement('div');
  header.className = 'tool-chip-header';
  const label = document.createElement('span');
  label.className = 'tool-chip-label';
  label.textContent = formatToolCallHeader(tc);
  header.append(label);

  if (level === 'full') {
    const chevron = document.createElement('span');
    chevron.className = 'tool-chip-chevron';
    chevron.textContent = '▸';
    header.append(chevron);
    chip.addEventListener('click', () => toggleChip(chip, chevron));
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.setAttribute('aria-expanded', 'false');
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); chip.click(); }
    });
  }
  chip.append(header);

  if (level === 'full') {
    const body = document.createElement('div');
    body.className = 'tool-chip-body';
    let code = `Arguments:\n${JSON.stringify(tc.arguments, null, 2)}`;
    if (tc.result) code += `\n\nResult:\n${tc.result.output}`;
    const pre = document.createElement('pre');
    pre.className = 'tool-chip-detail';
    if (tc.result?.isError) pre.classList.add('tool-chip-detail--error');
    pre.textContent = code;
    body.append(pre);
    chip.append(body);
  }
  return chip;
}

// ─── Helpers compartidos ──────────────────────────────────

export function toggleChip(chip: HTMLElement, chevron: HTMLElement) {
  const expanded = chip.classList.toggle('tool-chip--expanded');
  chevron.textContent = expanded ? '▾' : '▸';
  chip.setAttribute('aria-expanded', String(expanded));
}
