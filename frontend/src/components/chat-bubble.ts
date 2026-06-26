/**
 * chat-bubble.ts — Un mensaje del chat (user / assistant / toolResult / compaction).
 *
 * Devuelve un objeto `{ root, update, dispose }` que permite:
 *   - root: el HTMLElement para insertar en el DOM
 *   - update(newMessage): actualiza el DOM in-place (sin reconstruir)
 *   - dispose(): limpia subscripciones, timers, etc
 *
 * ## Render path unificado
 *
 * ChatBubble maneja TODOS los casos: user, assistant, toolResult,
 * compaction. El componente decide cómo renderizar según message.role.
 *
 * ## Streaming (assistant con isStreaming=true)
 *
 * El componente se auto-gestiona durante streaming:
 *   1. Se suscribe a `appState.streamingText` para recibir deltas
 *   2. Usa un StreamBuffer para revelar texto gradualmente
 *   3. El cursor y los thinking dots se animan automáticamente
 *   4. Cuando `streamingText` pasa a '' (agent_end), re-renderiza
 *      el texto como markdown en una sola pasada
 *
 * Para que esto funcione, ChatPage NO debe re-renderizar este bubble
 * durante streaming. La forma de evitar el re-render: el message
 * tiene un `id` estable, y ChatPage llama `update(msg)` en lugar de
 * `replaceChildren` cuando el id no cambia.
 *
 * Inspiración: Claude.ai (texto libre, sin bubble), ChatGPT (user bubble
 * a la derecha), DeepSeek (thinking block colapsable integrado), Cursor
 * (tool calls como cards inline).
 */

import type { ChatMessage, ToolCall, ThinkingBlock } from '../lib/state.ts';
import { appState } from '../lib/state.ts';
import { ThinkingBlockUI } from './thinking-block.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { formatToolCallHeader } from '../lib/format-tool-call.ts';
import { StreamBuffer } from '../lib/stream-buffer.ts';

export interface ChatBubbleHandle {
  root: HTMLElement;
  /** Actualiza el DOM in-place si el id coincide. Retorna true si actualizó. */
  update(newMessage: ChatMessage): boolean;
  /** Limpia subscripciones, timers, etc. */
  dispose(): void;
  /** El id del message que renderiza este bubble. */
  readonly id: string;
}

export function ChatBubble(message: ChatMessage): ChatBubbleHandle {
  if (message.role === 'toolResult') {
    return renderToolResultMessage(message);
  }
  if (message.role === 'compaction') {
    return renderCompactionDivider(message);
  }
  if (message.role === 'user') {
    return renderUserMessage(message);
  }
  return renderAssistantMessage(message);
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
  text.textContent = message.content;
  content.append(text);
  root.append(content);

  return {
    root,
    id: message.id,
    update: (newMessage) => {
      if (newMessage.id !== message.id || newMessage.role !== 'user') return false;
      if (newMessage.content !== message.content) {
        text.textContent = newMessage.content;
      }
      return true;
    },
    dispose: () => {},
  };
}

// ─── ASSISTANT ─────────────────────────────────────────────

function renderAssistantMessage(message: ChatMessage): ChatBubbleHandle {
  const root = document.createElement('div');
  root.className = 'message message--assistant';
  root.dataset.messageId = message.id;

  const content = document.createElement('div');
  content.className = 'message-content message-content--assistant';
  root.append(content);

  // Sub-elementos que podemos actualizar in-place
  let thinkingBlock: HTMLElement | null = null;
  let toolCallsContainer: HTMLElement | null = null;
  const toolCallElements = new Map<string, HTMLElement>();
  const textContainer = document.createElement('div');
  textContainer.className = 'message-text message-text--assistant';

  // Streamer (se crea si isStreaming)
  let streamer: StreamerHandle | null = null;

  function applyMessage(msg: ChatMessage): void {
    // 1. Thinking
    if (msg.thinking && msg.thinking.length > 0) {
      if (thinkingBlock) {
        // Update in-place: re-render si cambió la cantidad o el contenido
        const currentBody = thinkingBlock.querySelector('.thinking-body');
        const newContent = msg.thinking.map((b) => b.content).join('\n\n');
        if (currentBody && currentBody.textContent !== newContent) {
          currentBody.textContent = newContent;
        }
        // Update isStreaming flag
        if (msg.isStreaming) {
          thinkingBlock.classList.add('thinking-block--streaming');
        } else {
          thinkingBlock.classList.remove('thinking-block--streaming');
        }
      } else {
        thinkingBlock = ThinkingBlockUI(msg.thinking, msg.isStreaming ?? false);
        content.insertBefore(thinkingBlock, textContainer);
      }
    } else if (thinkingBlock) {
      thinkingBlock.remove();
      thinkingBlock = null;
    }

    // 2. Tool calls
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      if (!toolCallsContainer) {
        toolCallsContainer = document.createElement('div');
        toolCallsContainer.className = 'message-tool-calls';
        content.insertBefore(toolCallsContainer, textContainer);
      }
      // Sincronizar: agregar nuevos, actualizar existentes, remover faltantes
      const seen = new Set<string>();
      for (const tc of msg.toolCalls) {
        seen.add(tc.id);
        const existing = toolCallElements.get(tc.id);
        if (existing) {
          // Update in-place: status cambió? re-render header
          updateToolCallStatus(existing, tc);
        } else {
          const el = renderToolCall(tc);
          toolCallElements.set(tc.id, el);
          toolCallsContainer.append(el);
        }
      }
      // Remover los que ya no están
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

    // 3. Texto
    if (msg.isStreaming) {
      if (!streamer) {
        // Iniciar streaming
        textContainer.classList.add('message-text--streaming');
        textContainer.classList.add('message-text--has-cursor');
        textContainer.textContent = '';
        streamer = createStreamer(textContainer, () => {
          streamer = null;
        });
      }
      streamer.updateContent(msg.content);
    } else if (streamer) {
      // El streaming terminó y llega el content final via update().
      // Pasamos el content al streamer para que lo use en finish.
      streamer.updateContent(msg.content);
      // Forzar finish (no esperamos el subscriber de streamingText
      // porque puede haberse desuscribido antes)
      streamer.finish();
      streamer = null;
      textContainer.classList.remove('message-text--streaming');
      textContainer.classList.remove('message-text--has-cursor');
      textContainer.innerHTML = renderMarkdown(msg.content);
    } else {
      // No hay streamer: render markdown directo
      textContainer.classList.remove('message-text--streaming');
      textContainer.classList.remove('message-text--has-cursor');
      textContainer.innerHTML = renderMarkdown(msg.content);
    }
  }

  // Append del textContainer al final
  content.append(textContainer);

  // Initial render
  applyMessage(message);

  return {
    root,
    id: message.id,
    update: (newMessage) => {
      if (newMessage.id !== message.id || newMessage.role !== 'assistant') return false;
      applyMessage(newMessage);
      return true;
    },
    dispose: () => {
      if (streamer) streamer.dispose();
    },
  };
}

/** Streamer handle — encapsula el ciclo de vida del streaming */
interface StreamerHandle {
  dispose(): void;
  updateContent(fullText: string): void;
  /** Fuerra el fin del streaming con el content actual. Idempotente. */
  finish(): void;
}

function createStreamer(
  textContainer: HTMLElement,
  onDone: () => void,
): StreamerHandle {
  let prevStreamLen = 0;
  let isFinished = false;
  let isDisposed = false;

  // Snapshot del content actual al momento de finish: el contenido
  // completo del mensaje se pasa al render markdown.
  let finalContent = '';

  const streamBuffer = new StreamBuffer({
    onUpdate: (text) => {
      if (isDisposed) return;
      textContainer.textContent = text;
    },
    onDone: () => {
      if (isDisposed || !isFinished) return;
      // Buffer terminó de drenar después de finish: render markdown
      textContainer.classList.remove('message-text--streaming');
      textContainer.classList.remove('message-text--has-cursor');
      textContainer.innerHTML = renderMarkdown(finalContent);
      onDone();
    },
  });

  function finish(content: string): void {
    if (isFinished) return;
    isFinished = true;
    finalContent = content;
    if (streamBuffer.isActive) {
      // Hay texto pendiente — sync reveal + markdown
      textContainer.textContent = streamBuffer.total;
      streamBuffer.reset();
    }
    textContainer.classList.remove('message-text--streaming');
    textContainer.classList.remove('message-text--has-cursor');
    textContainer.innerHTML = renderMarkdown(content);
    onDone();
  }

  // Subscribe a streamingText
  const unsubscribe = appState.streamingText.subscribe((text) => {
    if (isDisposed) return;
    if (text === '' && prevStreamLen > 0) {
      // agent_end
      prevStreamLen = 0;
      unsubscribe();
      // El content final viene del último message (snapshot en
      // updateContent o del messages array al momento de finish)
      finish(lastContent);
      return;
    }
    if (text.length > prevStreamLen) {
      const delta = text.slice(prevStreamLen);
      prevStreamLen = text.length;
      streamBuffer.push(delta);
    }
  });

  // Track del último content visto (para usar en finish)
  let lastContent = '';

  // Si ya hay contenido al attach, procesarlo
  const current = appState.streamingText.value;
  if (current.length > 0 && current.length > prevStreamLen) {
    const delta = current.slice(prevStreamLen);
    prevStreamLen = current.length;
    streamBuffer.push(delta);
  }

  return {
    dispose: () => {
      if (isDisposed) return;
      isDisposed = true;
      unsubscribe();
      streamBuffer.reset();
    },
    updateContent: (fullText: string) => {
      if (isDisposed || isFinished) return;
      lastContent = fullText;
      // Si el contenido creció, procesar el delta
      if (fullText.length > prevStreamLen) {
        const delta = fullText.slice(prevStreamLen);
        prevStreamLen = fullText.length;
        streamBuffer.push(delta);
      }
    },
    finish: () => {
      if (isDisposed || isFinished) return;
      finish(lastContent);
    },
  };
}

// ─── TOOL CALL ─────────────────────────────────────────────

function renderToolCall(tc: ToolCall): HTMLElement {
  const state = computeToolState(tc);
  const details = document.createElement('details');
  details.className = `tool-call tool-call--${state}`;
  details.dataset.toolCallId = tc.id;
  details.open = false;

  const summary = document.createElement('summary');
  summary.className = 'tool-call-header';

  const name = document.createElement('span');
  name.className = 'tool-call-name';
  name.textContent = formatToolCallHeader(tc);
  summary.append(name);

  const status = document.createElement('span');
  status.className = `tool-call-status tool-call-status--${state}`;
  status.setAttribute('aria-label', statusLabel(state));
  summary.append(status);

  details.append(summary);

  const body = document.createElement('pre');
  body.className = 'tool-call-body';
  body.textContent = JSON.stringify(tc.arguments, null, 2);
  details.append(body);

  return details;
}

function updateToolCallStatus(el: HTMLElement, tc: ToolCall): void {
  const state = computeToolState(tc);
  el.className = `tool-call tool-call--${state}`;
  const status = el.querySelector('.tool-call-status');
  if (status) {
    status.className = `tool-call-status tool-call-status--${state}`;
    status.setAttribute('aria-label', statusLabel(state));
  }
}

function computeToolState(tc: ToolCall): 'pending' | 'success' | 'error' {
  if (tc.result === undefined) return 'pending';
  return tc.isError ? 'error' : 'success';
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

  if (message.toolResult) {
    const isError = message.toolResult.isError;
    const details = document.createElement('details');
    details.className = `tool-result-card${isError ? ' tool-result-card--error' : ''}`;
    details.open = false;

    const summary = document.createElement('summary');
    summary.className = 'tool-result-header';

    const name = document.createElement('span');
    name.className = 'tool-result-name';
    name.textContent = `Result: ${message.toolResult.toolName}`;
    summary.append(name);

    details.append(summary);

    const body = document.createElement('pre');
    body.className = 'tool-result-body';
    body.textContent = message.content;
    details.append(body);

    root.append(details);
  }

  return {
    root,
    id: message.id,
    update: (newMessage) => {
      if (newMessage.id !== message.id) return false;
      // toolResult no se actualiza en su lugar — si cambia, re-mount
      return false;
    },
    dispose: () => {},
  };
}

// ─── COMPACTION DIVIDER ───────────────────────────────────

function renderCompactionDivider(message: ChatMessage): ChatBubbleHandle {
  const root = document.createElement('div');
  root.className = 'message message--compaction';
  root.dataset.messageId = message.id;

  const tokensBefore = message.compaction?.tokensBefore ?? 0;
  const formatted = formatTokens(tokensBefore);

  const details = document.createElement('details');
  details.className = 'compaction-divider';

  const summary = document.createElement('summary');
  summary.className = 'compaction-summary';
  summary.textContent = `Compaction: ${formatted} compactados`;
  details.append(summary);

  if (message.content) {
    const body = document.createElement('pre');
    body.className = 'compaction-body';
    body.textContent = message.content;
    details.append(body);
  }

  root.append(details);

  return {
    root,
    id: message.id,
    update: () => false,
    dispose: () => {},
  };
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n} tokens`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K tokens`;
  return `${(n / 1_000_000).toFixed(2)}M tokens`;
}
