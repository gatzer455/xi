/**
 * chat-bubble.ts — Un mensaje del chat (user / assistant / toolResult / compaction).
 *
 * Arquitectura chat-architecture-v2: renderiza el modelo de Parts
 * (lib/chat/types.ts). Devuelve un handle `{ root, update, dispose, id }`.
 *
 *   - root: HTMLElement para insertar en el DOM.
 *   - update(newMessage): actualiza el DOM in-place. Para assistant
 *     streaming, extrae el delta del texto (diff vs el message
 *     anterior) y lo empuja al StreamBuffer para reveal suave (D6).
 *   - dispose(): limpia StreamBuffer y subscripciones.
 *
 * El componente NO se suscribe a ninguna signal global. Recibe el
 * mensaje y, durante streaming, maneja su propio StreamBuffer. La
 *úa fuente de truth es el `ChatMessage` que el ChatPage le pasa
 * vía `update()` (que viene del ChatStore del activeTab).
 */

import type {
  ChatMessage,
  Part,
  TextPart,
  ThinkingPart,
  ToolCallPart,
  ToolResultPart,
  CompactionPart,
  ToolState,
} from '../lib/chat/types.ts';
import { extractText } from '../lib/chat/mapping.ts';
import { ThinkingBlockUI } from './thinking-block.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { formatToolCallHeader } from '../lib/format-tool-call.ts';
import { SmoothStreamer } from '../lib/smooth-streamer.ts';

export interface ChatBubbleHandle {
  root: HTMLElement;
  /** Actualiza el DOM in-place con el nuevo mensaje (mismo id). */
  update(newMessage: ChatMessage): void;
  /** Limpia StreamBuffer y referencias. */
  dispose(): void;
  /** El id del message que renderiza este bubble. */
  readonly id: string;
}

export function ChatBubble(message: ChatMessage): ChatBubbleHandle {
  switch (message.role) {
    case 'user':       return renderUserMessage(message);
    case 'toolResult': return renderToolResultMessage(message);
    case 'compaction': return renderCompactionDivider(message);
    case 'assistant':  return renderAssistantMessage(message);
  }
}

// ─── USER ──────────────────────────────────────────────────

function renderUserMessage(message: ChatMessage): ChatBubbleHandle {
  const root = document.createElement('div');
  root.className = 'message message--user';
  root.dataset.messageId = message.id;

  const content = document.createElement('div');
  content.className = 'message-content message-content--user';

  const text = document.createElement('div');
  text.className = 'message-text message-text--user';
  text.textContent = extractText(message);
  content.append(text);
  root.append(content);

  let current = extractText(message);
  return {
    root,
    id: message.id,
    update: (newMessage) => {
      if (newMessage.id !== message.id || newMessage.role !== 'user') return;
      const t = extractText(newMessage);
      if (t !== current) {
        current = t;
        text.textContent = t;
      }
    },
    dispose: () => {},
  };
}

// ─── ASSISTANT ─────────────────────────────────────────────

function renderAssistantMessage(message: ChatMessage): ChatBubbleHandle {
  const root = document.createElement('div');
  root.className = 'message message--assistant';
  root.dataset.messageId = message.id;
  if (message.isStreaming) root.classList.add('message--streaming');

  const content = document.createElement('div');
  content.className = 'message-content message-content--assistant';
  root.append(content);

  // Sub-elementos posicionados: thinking, toolCalls, text.
  let thinkingBlock: HTMLElement | null = null;
  let toolCallsContainer: HTMLElement | null = null;
  const toolCallElements = new Map<string, HTMLElement>();
  const textContainer = document.createElement('div');
  textContainer.className = 'message-text message-text--assistant';

  let streamer: SmoothStreamerHandle | null = null;
  let currentMsg = message;
  let currentText = extractText(message);

  content.append(textContainer);

  applyMessage(message);

  function applyMessage(msg: ChatMessage): void {
    // 1. Thinking parts
    const thinkingParts = msg.parts.filter(isThinking) as ThinkingPart[];
    applyThinking(thinkingParts, msg.isStreaming ?? false);

    // 2. ToolCall parts
    const toolCallParts = msg.parts.filter(isToolCall) as ToolCallPart[];
    applyToolCalls(toolCallParts);

    // 3. Text parts (streaming-aware)
    const newText = extractText(msg);
    applyText(msg, newText);
  }

  function applyThinking(parts: ThinkingPart[], streaming: boolean): void {
    if (parts.length > 0) {
      if (thinkingBlock) {
        const body = thinkingBlock.querySelector('.thinking-body');
        const joined = parts.map((p) => p.text).join('\n\n');
        if (body && body.textContent !== joined) body.textContent = joined;
        thinkingBlock.classList.toggle('thinking-block--streaming', streaming);
      } else {
        thinkingBlock = ThinkingBlockUI(parts, streaming);
        content.insertBefore(thinkingBlock, textContainer);
      }
    } else if (thinkingBlock) {
      thinkingBlock.remove();
      thinkingBlock = null;
    }
  }

  function applyToolCalls(parts: ToolCallPart[]): void {
    if (parts.length > 0) {
      if (!toolCallsContainer) {
        toolCallsContainer = document.createElement('div');
        toolCallsContainer.className = 'message-tool-calls';
        content.insertBefore(toolCallsContainer, textContainer);
      }
      const seen = new Set<string>();
      for (const tc of parts) {
        seen.add(tc.toolCallId);
        const existing = toolCallElements.get(tc.toolCallId);
        if (existing) {
          updateToolCallStatus(existing, tc);
        } else {
          const el = renderToolCall(tc);
          toolCallElements.set(tc.toolCallId, el);
          toolCallsContainer.append(el);
        }
      }
      for (const [id, el] of toolCallElements) {
        if (!seen.has(id)) {
          el.remove();
          toolCallElements.delete(id);
        }
      }
    } else if (toolCallsContainer) {
      toolCallsContainer.remove();
      toolCallElements.clear();
      toolCallsContainer = null;
    }
  }

  function applyText(msg: ChatMessage, newText: string): void {
    if (msg.isStreaming) {
      if (!streamer) {
        textContainer.classList.add('message-text--streaming');
        streamer = createSmoothStreamer(textContainer);
      }
      streamer.updateText(newText);
    } else if (streamer) {
      streamer.finish(newText);
      streamer = null;
      textContainer.classList.remove('message-text--streaming');
    } else {
      textContainer.classList.remove('message-text--streaming');
      if (newText !== currentText || textContainer.children.length === 0) {
        textContainer.innerHTML = renderMarkdown(newText);
      }
    }
    currentText = newText;
  }

  return {
    root,
    id: message.id,
    update: (newMessage) => {
      if (newMessage.id !== message.id || newMessage.role !== 'assistant') return;
      currentMsg = newMessage;
      applyMessage(newMessage);
    },
    dispose: () => {
      if (streamer) streamer.dispose();
    },
  };
}

// ─── SmoothStreamer wrapper (delta extraction + rAF rendering) ────

interface SmoothStreamerHandle {
  dispose(): void;
  /** Recibe el texto COMPLETO actual; empuja el delta al SmoothStreamer. */
  updateText(fullText: string): void;
  /** Fuerza el flush del último frame. Idempotente. */
  finish(finalText: string): void;
}

function createSmoothStreamer(textContainer: HTMLElement): SmoothStreamerHandle {
  let prevLen = 0;
  let isFinished = false;
  let isDisposed = false;
  let pendingEl: HTMLElement | null = null;

  const streamer = new SmoothStreamer(
    // onSentence: oración completa → append con fade-in
    (html) => {
      const el = document.createElement('div');
      el.className = 'md-sentence fade-in';
      el.innerHTML = html;
      // Insertar antes del pendingEl si existe
      if (pendingEl) {
        textContainer.insertBefore(el, pendingEl);
      } else {
        textContainer.appendChild(el);
      }
    },
    // onPending: tail incompleto → re-renderizar in-place
    (html) => {
      if (html) {
        if (!pendingEl) {
          pendingEl = document.createElement('div');
          pendingEl.className = 'md-sentence md-sentence--pending';
          textContainer.appendChild(pendingEl);
        }
        pendingEl.innerHTML = html;
      } else if (pendingEl) {
        pendingEl.remove();
        pendingEl = null;
      }
    },
  );

  return {
    dispose: () => {
      if (isDisposed) return;
      isDisposed = true;
      streamer.dispose();
    },
    updateText: (fullText: string) => {
      if (isDisposed || isFinished) return;
      if (fullText.length > prevLen) {
        const delta = fullText.slice(prevLen);
        prevLen = fullText.length;
        streamer.push(delta);
      }
    },
    finish: (finalText: string) => {
      if (isDisposed || isFinished) return;
      isFinished = true;
      if (finalText.length > prevLen) {
        streamer.push(finalText.slice(prevLen));
        prevLen = finalText.length;
      }
      streamer.flush();
      streamer.dispose();
      if (pendingEl) {
        pendingEl.remove();
        pendingEl = null;
      }
    },
  };
}

// ─── TOOL CALL ─────────────────────────────────────────────

function renderToolCall(tc: ToolCallPart): HTMLElement {
  const visual = toolVisualState(tc.state);
  const details = document.createElement('details');
  details.className = `tool-call tool-call--${visual}`;
  details.dataset.toolCallId = tc.toolCallId;
  details.open = false;

  const summary = document.createElement('summary');
  summary.className = 'tool-call-header';

  const name = document.createElement('span');
  name.className = 'tool-call-name';
  name.textContent = formatToolCallHeader(tc);
  summary.append(name);

  const status = document.createElement('span');
  status.className = `tool-call-status tool-call-status--${visual}`;
  status.setAttribute('aria-label', statusLabel(visual));
  summary.append(status);

  details.append(summary);

  const body = document.createElement('pre');
  body.className = 'tool-call-body';
  body.textContent = JSON.stringify(tc.arguments, null, 2);
  details.append(body);

  return details;
}

function updateToolCallStatus(el: HTMLElement, tc: ToolCallPart): void {
  const visual = toolVisualState(tc.state);
  el.className = `tool-call tool-call--${visual}`;
  const status = el.querySelector('.tool-call-status');
  if (status) {
    status.className = `tool-call-status tool-call-status--${visual}`;
    status.setAttribute('aria-label', statusLabel(visual));
  }
}

/** Mapea el ToolState del reducer a las 3 clases visuales del CSS. */
function toolVisualState(state: ToolState): 'pending' | 'success' | 'error' {
  if (state === 'completed') return 'success';
  if (state === 'failed') return 'error';
  return 'pending';
}

function statusLabel(state: 'pending' | 'success' | 'error'): string {
  switch (state) {
    case 'pending': return 'Ejecutando';
    case 'success': return 'Completado';
    case 'error': return 'Error';
  }
}

// ─── TOOL RESULT (mensaje aparte) ─────────────────────────

function renderToolResultMessage(message: ChatMessage): ChatBubbleHandle {
  const root = document.createElement('div');
  root.className = 'message message--toolResult';
  root.dataset.messageId = message.id;

  const part = message.parts.find(isToolResult) as ToolResultPart | undefined;
  if (part) {
    const details = document.createElement('details');
    details.className = `tool-result-card${part.isError ? ' tool-result-card--error' : ''}`;
    details.open = false;

    const summary = document.createElement('summary');
    summary.className = 'tool-result-header';

    const name = document.createElement('span');
    name.className = 'tool-result-name';
    name.textContent = `Result: ${part.toolName}`;
    summary.append(name);

    details.append(summary);

    const body = document.createElement('pre');
    body.className = 'tool-result-body';
    body.textContent = part.result.output;
    details.append(body);

    root.append(details);
  }

  return {
    root,
    id: message.id,
    update: () => { /* toolResult no se actualiza in-place */ },
    dispose: () => {},
  };
}

// ─── COMPACTION DIVIDER ───────────────────────────────────

function renderCompactionDivider(message: ChatMessage): ChatBubbleHandle {
  const root = document.createElement('div');
  root.className = 'message message--compaction';
  root.dataset.messageId = message.id;

  const part = message.parts.find(isCompaction) as CompactionPart | undefined;
  const tokensBefore = part?.tokensBefore ?? 0;
  const summary = part?.summary ?? '';

  const details = document.createElement('details');
  details.className = 'compaction-divider';

  const summaryEl = document.createElement('summary');
  summaryEl.className = 'compaction-summary';
  summaryEl.textContent = `Compaction: ${formatTokens(tokensBefore)} compactados`;
  details.append(summaryEl);

  if (summary) {
    const body = document.createElement('pre');
    body.className = 'compaction-body';
    body.textContent = summary;
    details.append(body);
  }

  root.append(details);

  return {
    root,
    id: message.id,
    update: () => {},
    dispose: () => {},
  };
}

// ─── Helpers ──────────────────────────────────────────────

const isThinking = (p: Part): p is ThinkingPart => p.type === 'thinking';
const isToolCall = (p: Part): p is ToolCallPart => p.type === 'toolCall';
const isToolResult = (p: Part): p is ToolResultPart => p.type === 'toolResult';
const isCompaction = (p: Part): p is CompactionPart => p.type === 'compaction';

function formatTokens(n: number): string {
  if (n < 1000) return `${n} tokens`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K tokens`;
  return `${(n / 1_000_000).toFixed(2)}M tokens`;
}