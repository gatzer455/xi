/**
 * tool-chip-group.ts — Contenedor de chips (thinking + tool calls).
 *
 * Decide la fase visual (inferencia/escritura/completado) y orquesta
 * ThinkingChip + ToolCallGroup según las parts del mensaje.
 *
 * Fases:
 *   - inferencing: spinner en el contenedor (pensando + tools corriendo)
 *   - writing:      pixel dot quieto (texto streaming, sin tools activas)
 *   - done:         sin indicador (mensaje completo)
 */

import type { ChatMessage, ThinkingPart, ToolCallPart } from '../lib/chat/types.ts';
import { extractText, groupToolCalls } from '../lib/chat/mapping.ts';
import { ThinkingChip } from './thinking-chip.ts';
import { ToolCallGroup } from './tool-call-group.ts';

/** Fase visual de un mensaje assistant. */
export type ChipPhase = 'inferencing' | 'writing' | 'done';

/** Renderiza el contenedor de chips para un mensaje assistant.
 *
 *  @param msg Mensaje assistant completo
 *  @returns Elemento HTMLElement o null si no hay chips que mostrar
 */
export function ToolChipGroup(msg: ChatMessage): HTMLElement | null {
  const thinkingParts = msg.parts.filter(isThinking) as ThinkingPart[];
  const toolCallParts = msg.parts.filter(isToolCall) as ToolCallPart[];
  const hasText = extractText(msg).length > 0;

  // No hay nada que mostrar
  if (thinkingParts.length === 0 && toolCallParts.length === 0) return null;

  const phase = determinePhase(msg, thinkingParts, toolCallParts, hasText);

  const container = document.createElement('div');
  container.className = `tool-chip-group tool-chip-group--${phase}`;

  // Thinking chip
  if (thinkingParts.length > 0) {
    const chip = ThinkingChip(thinkingParts, {
      isStreaming: phase === 'inferencing',
    });
    container.append(chip);
  }

  // Tool call group (solo si hay tool calls)
  if (toolCallParts.length > 0) {
    const groups = groupToolCalls(toolCallParts);
    const group = ToolCallGroup(groups);
    container.append(group);
  }

  return container;
}

/** Determina la fase visual basada en el estado del mensaje. */
function determinePhase(
  msg: ChatMessage,
  thinkingParts: ThinkingPart[],
  toolCallParts: ToolCallPart[],
  hasText: boolean,
): ChipPhase {
  if (!msg.isStreaming) return 'done';

  // Si hay thinking activo(sin completar) o tool calls pendientes/running → inferencing
  const hasActiveInference = thinkingParts.length > 0 || 
    toolCallParts.some(tc => tc.state === 'pending' || tc.state === 'running');

  if (hasActiveInference) return 'inferencing';

  // Si está streaming pero no hay inferencia activa, es text streaming → writing
  if (hasText || msg.isStreaming) return 'writing';

  return 'done';
}

// ─── Helpers ──────────────────────────────────────────────

const isThinking = (p: { type: string }): p is ThinkingPart => p.type === 'thinking';
const isToolCall = (p: { type: string }): p is ToolCallPart => p.type === 'toolCall';
