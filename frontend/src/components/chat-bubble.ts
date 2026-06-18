/**
 * chat-bubble.ts — Componente de burbuja de chat (Capa 1: Rendering)
 *
 * Renderiza un mensaje del usuario o del asistente. Cada burbuja es
 * autocontenida: avatar + contenido (thinking + tool calls + texto + cursor).
 *
 * Estructura del assistant bubble (orden visual, ver D8 del design):
 *   1. Thinking blocks (si hay) — colapsable
 *   2. Tool calls (si hay) — colapsable con args y result
 *   3. Texto del assistant
 *   4. Cursor streaming (si isStreaming=true)
 */

import type { ChatMessage, ToolCall } from '../lib/state.ts';
import { ThinkingBlockUI } from './thinking-block.ts';

export function ChatBubble(message: ChatMessage): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${message.role}`;

  // ═══ Avatar ═══
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = message.role === 'user' ? '👤' : '✦';
  wrapper.append(avatar);

  // ═══ Content ═══
  const content = document.createElement('div');
  content.className = 'message-content';

  if (message.role === 'assistant') {
    // 1. Thinking (colapsable, primero) — ver R2
    if (message.thinking && message.thinking.length > 0) {
      content.append(ThinkingBlockUI(message.thinking));
    }

    // 2. Tool calls (colapsable, después del thinking) — ver R3
    if (message.toolCalls && message.toolCalls.length > 0) {
      message.toolCalls.forEach((tc) => content.append(renderToolCall(tc)));
    }
  }

  // 3. Texto del mensaje — común a user y assistant
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble' + (message.isStreaming ? ' streaming' : '');
  bubble.textContent = message.content;

  // 4. Cursor streaming — solo assistant, solo si isStreaming=true
  //    Ver R4: glifo ▍ (U+258D), aria-hidden porque es decorativo
  if (message.role === 'assistant' && message.isStreaming) {
    const cursor = document.createElement('span');
    cursor.className = 'streaming-cursor';
    cursor.textContent = '\u258D';
    cursor.setAttribute('aria-hidden', 'true');
    bubble.append(cursor);
  }

  content.append(bubble);
  wrapper.append(content);

  return wrapper;
}

// ───────────────────────────────────────────────────────
// Helpers privados — guard clauses, sin anidación > 2
// ───────────────────────────────────────────────────────

/**
 * Renderiza un mensaje de tipo toolResult como una mini-card colapsable
 * (hermana del tool call que la produjo). Fiel al JSONL: el tool result
 * es un mensaje aparte, no se acopla al assistant message.
 */
function renderToolResultCard(message: ChatMessage): HTMLElement {
  const details = document.createElement('details');
  details.className = 'tool-result-card';
  if (message.toolResult?.isError) details.classList.add('is-error');

  const summary = document.createElement('summary');
  summary.className = 'tool-result-header';

  const icon = document.createElement('span');
  icon.className = 'tool-result-icon';
  icon.textContent = message.toolResult?.isError ? '✗' : '✓';
  summary.append(icon);

  const name = document.createElement('span');
  name.className = 'tool-result-name';
  name.textContent = `Result: ${message.toolResult?.toolName ?? 'tool'}`;
  summary.append(name);

  details.append(summary);

  const body = document.createElement('pre');
  body.className = 'tool-result-body';
  body.textContent = message.content;
  details.append(body);

  return details;
}

/**
 * Renderiza un tool call como card colapsable. Helper privado extraído
 * del monolítico original. Status se calcula de `result` + `isError`.
 */
function renderToolCall(tc: ToolCall): HTMLElement {
  const details = document.createElement('details');
  details.className = 'tool-call';
  details.open = true; // El card entero arranca expandido (args visibles)

  // ── Header: icono + nombre + status badge ──
  const header = document.createElement('summary');
  header.className = 'tool-call-header';

  const icon = document.createElement('span');
  icon.className = 'tool-call-icon';
  icon.textContent = '⚡';
  header.append(icon);

  const name = document.createElement('span');
  name.className = 'tool-call-name';
  name.textContent = tc.name;
  header.append(name);

  const state = computeStatus(tc);
  const status = document.createElement('span');
  status.className = `tool-call-status tool-call-status--${state}`;
  status.setAttribute('aria-label', statusLabel(state));
  status.textContent = statusGlyph(state);
  header.append(status);

  details.append(header);

  // ── Args (expandido por default — info clave para entender la tool) ──
  details.append(renderToolSection('Argumentos', tc.arguments, 'tool-call-args', true));

  // ── Result (colapsado por default — puede ser muy largo) ──
  if (tc.result !== undefined) {
    details.append(renderToolSection('Output', tc.result, 'tool-call-result', false));
  }

  return details;
}

/**
 * Renderiza una sub-sección colapsable del tool call (args o result).
 * Reutilizada para evitar duplicación entre args y result.
 */
function renderToolSection(
  label: string,
  content: unknown,
  preClass: string,
  openByDefault: boolean,
): HTMLElement {
  const section = document.createElement('details');
  section.className = 'tool-call-section';
  section.open = openByDefault;

  const summary = document.createElement('summary');
  summary.textContent = label;
  section.append(summary);

  const pre = document.createElement('pre');
  pre.className = preClass;
  pre.textContent = formatContent(content);
  section.append(pre);

  return section;
}

/**
 * Formatea el contenido del tool section. Strings se pasan tal cual;
 * objetos se serializan con `JSON.stringify` pretty-print de 2 espacios.
 */
function formatContent(content: unknown): string {
  if (typeof content === 'string') return content;
  return JSON.stringify(content, null, 2);
}

/**
 * Calcula el estado del tool call a partir de result + isError.
 *   - Sin result → running
 *   - Con result + isError → error
 *   - Con result sin isError → done
 */
function computeStatus(tc: ToolCall): 'running' | 'done' | 'error' {
  if (tc.result === undefined) return 'running';
  return tc.isError ? 'error' : 'done';
}

function statusGlyph(state: 'running' | 'done' | 'error'): string {
  switch (state) {
    case 'running': return '●';
    case 'done': return '✓';
    case 'error': return '✗';
  }
}

function statusLabel(state: 'running' | 'done' | 'error'): string {
  switch (state) {
    case 'running': return 'Ejecutando';
    case 'done': return 'Completado';
    case 'error': return 'Error';
  }
}
