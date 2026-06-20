/**
 * chat-bubble.ts — Componente de burbuja de chat (Capa 1: Rendering)
 *
 * Renderiza un mensaje del usuario o del asistente. Cada burbuja es
 * autocontenida: avatar + contenido (thinking + tool calls + texto + cursor).
 *
 * Estructura del assistant bubble (orden visual, ver D8 del design):
 *   1. Thinking blocks (si hay) — colapsable
 *   2. Tool calls (si hay) — colapsable, header con format legible
 *   3. Texto del assistant — RENDERIZADO COMO MARKDOWN
 *   4. Cursor streaming (si isStreaming=true)
 *
 * El markdown usa `lib/markdown.ts` (markdown-it + highlight.js). El
 * header de los tool calls usa `lib/format-tool-call.ts` (fiel a pi TUI:
 * `bash` → `$ cmd`, `read` → `read path:lines`, etc).
 */

import type { ChatMessage, ToolCall } from '../lib/state.ts';
import { ThinkingBlockUI } from './thinking-block.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { formatToolCallHeader } from '../lib/format-tool-call.ts';

export function ChatBubble(message: ChatMessage): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${message.role}`;

  // toolResult no tiene avatar — es un resultado anidado, no un turno.
  if (message.role === 'toolResult') {
    wrapper.append(renderToolResultCard(message));
    return wrapper;
  }

  // Avatar eliminado — diseño limpio sin avatares (como Claude/Gemini)

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

  // 3. Texto del mensaje
  //    - user: texto plano (no markdown — los user prompts no son markdown)
  //    - assistant: RENDERIZADO COMO MARKDOWN
  const textContainer = document.createElement('div');
  textContainer.className = 'message-text';
  if (message.role === 'user') {
    textContainer.textContent = message.content;
  } else {
    textContainer.innerHTML = renderMarkdown(message.content);
  }

  // 4. Cursor streaming — solo assistant, solo si isStreaming=true
  if (message.role === 'assistant' && message.isStreaming) {
    const cursor = document.createElement('span');
    cursor.className = 'streaming-cursor';
    cursor.textContent = '\u258D';
    cursor.setAttribute('aria-hidden', 'true');
    textContainer.append(cursor);
  }

  content.append(textContainer);
  wrapper.append(content);

  return wrapper;
}

// ───────────────────────────────────────────────────────────────
// Helpers privados — guard clauses, sin anidación > 2
// ───────────────────────────────────────────────────────────────

/**
 * Renderiza un mensaje de tipo toolResult como una mini-card colapsable
 * (hermana del tool call que la produjo). Fiel al JSONL: el tool result
 * es un mensaje aparte, no se acopla al assistant message. Background
 * usa los tokens pi-light (toolSuccessBg/toolErrorBg).
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
 * Renderiza un tool call como card colapsable con formato legible
 * (fiel a pi TUI). El header usa `formatToolCallHeader`:
 *   - `bash` → `$ <command>`
 *   - `read` → `read <path>:<lineRange>`
 *   - `write` → `write <path>`
 *   - etc.
 *
 * El background cambia según el estado (pending/success/error),
 * usando los tokens de pi-light.
 */
function renderToolCall(tc: ToolCall): HTMLElement {
  const state = computeStatus(tc);
  const details = document.createElement('details');
  details.className = `tool-call tool-call--${state}`;
  details.open = false; // Colapsado por default (background ya da info)

  const summary = document.createElement('summary');
  summary.className = 'tool-call-header';

  const icon = document.createElement('span');
  icon.className = 'tool-call-icon';
  icon.textContent = TOOL_ICONS[tc.name] ?? '⚡';
  summary.append(icon);

  const name = document.createElement('span');
  name.className = 'tool-call-name';
  name.textContent = formatToolCallHeader(tc);
  summary.append(name);

  const status = document.createElement('span');
  status.className = `tool-call-status tool-call-status--${state}`;
  status.setAttribute('aria-label', statusLabel(state));
  status.textContent = statusGlyph(state);
  summary.append(status);

  details.append(summary);

  // Body = el output de la tool (result). Solo si hay result.
  if (tc.result !== undefined) {
    const body = document.createElement('pre');
    body.className = 'tool-call-body';
    body.textContent = extractToolOutput(tc.result);
    details.append(body);
  }

  return details;
}

/**
 * Extrae el output textual de un tool result. El result puede ser:
 *   - string (output crudo)
 *   - array de bloques (formato pi: `[{type: "text", text: "..."}]`)
 *   - objeto con `content` (formato pi AgentMessage ToolResultMessage)
 *
 * Devuelve un string plano para mostrar en el `<pre>` del body.
 */
function extractToolOutput(result: unknown): string {
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    return result
      .filter((b): b is { type: 'text'; text: string } =>
        b && typeof b === 'object' && (b as { type?: unknown }).type === 'text'
        && typeof (b as { text?: unknown }).text === 'string')
      .map(b => b.text)
      .join('\n');
  }
  if (result && typeof result === 'object') {
    const obj = result as { content?: unknown; output?: unknown };
    if (Array.isArray(obj.content)) {
      return obj.content
        .filter((b): b is { type: 'text'; text: string } =>
          b && typeof b === 'object' && (b as { type?: unknown }).type === 'text'
          && typeof (b as { text?: unknown }).text === 'string')
        .map(b => b.text)
        .join('\n');
    }
    if (typeof obj.output === 'string') return obj.output;
  }
  return JSON.stringify(result, null, 2);
}

/**
 * Calcula el estado del tool call a partir de result + isError.
 *   - Sin result → running
 *   - Con result + isError → error
 *   - Con result sin isError → success
 */
function computeStatus(tc: ToolCall): 'pending' | 'success' | 'error' {
  if (tc.result === undefined) return 'pending';
  return tc.isError ? 'error' : 'success';
}

function statusGlyph(state: 'pending' | 'success' | 'error'): string {
  switch (state) {
    case 'pending': return '●';
    case 'success': return '✓';
    case 'error': return '✗';
  }
}

function statusLabel(state: 'pending' | 'success' | 'error'): string {
  switch (state) {
    case 'pending': return 'Ejecutando';
    case 'success': return 'Completado';
    case 'error': return 'Error';
  }
}

/**
 * Iconos por tool (1 char o emoji corto). Siguen la convención de pi TUI:
 * - bash: `$` (terminal)
 * - read: `→` (leer archivo)
 * - write/edit: `✎` (escribir)
 * - find/grep: `⌕` (buscar)
 * - ls: `≡` (listar)
 */
const TOOL_ICONS: Record<string, string> = {
  bash: '$',
  read: '→',
  write: '✎',
  edit: '✎',
  find: '⌕',
  grep: '⌕',
  ls: '≡',
};
