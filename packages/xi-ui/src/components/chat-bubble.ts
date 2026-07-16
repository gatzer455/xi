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
  ThinkingPart,
  ToolCallPart,
  ToolResultPart,
  CompactionPart,
} from '../lib/chat/types.ts';
import { extractText } from '../lib/chat/mapping.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { SmoothStreamer, reconcileDom } from '../lib/smooth-streamer.ts';
import { ToolChipGroup } from './chip-groups.ts';

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

  // Tool chip group (thinking + tool calls combinados)
  let chipGroupEl: HTMLElement | null = null;

  const textContainer = document.createElement('div');
  textContainer.className = 'message-text message-text--assistant';

  let streamer: SmoothStreamerHandle | null = null;
  let currentMsg = message;
  let currentText = extractText(message);

  content.append(textContainer);

  applyMessage(message);

  function applyMessage(msg: ChatMessage): void {
    // 1. Tool chips (thinking + tool calls)
    applyToolChips(msg);

    // 2. Text parts (streaming-aware)
    const newText = extractText(msg);
    applyText(msg, newText);
  }

  function applyToolChips(msg: ChatMessage): void {
    const newChipGroup = ToolChipGroup(msg);
    if (newChipGroup) {
      if (chipGroupEl) {
        chipGroupEl.replaceWith(newChipGroup);
      } else {
        content.insertBefore(newChipGroup, textContainer);
      }
      chipGroupEl = newChipGroup;
    } else if (chipGroupEl) {
      chipGroupEl.remove();
      chipGroupEl = null;
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

// ─── SmoothStreamer wrapper (delta extraction + DOM reconciliation) ────

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

  const streamer = new SmoothStreamer((html) => {
    reconcileDom(textContainer, html);
  });

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
    },
  };
}

// ─── TOOL RESULT (mensaje aparte) ─────────────────────────

function renderToolResultMessage(message: ChatMessage): ChatBubbleHandle {
  // Los tool results ya no se renderizan como bubbles separados.
  // El reducer mergea el output al ToolCallPart correspondiente,
  // y se muestra inline dentro del chip expandido (tool-call-chip).
  const root = document.createElement('div');
  root.className = 'message message--toolResult';
  root.dataset.messageId = message.id;
  root.style.display = 'none';

  return {
    root,
    id: message.id,
    update: () => {},
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
const isToolResult = (p: Part): p is ToolResultPart => p.type === 'toolResult';
const isCompaction = (p: Part): p is CompactionPart => p.type === 'compaction';

function formatTokens(n: number): string {
  if (n < 1000) return `${n} tokens`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K tokens`;
  return `${(n / 1_000_000).toFixed(2)}M tokens`;
}