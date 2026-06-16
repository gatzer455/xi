/**
 * chat-input.ts — Componente de input de chat (Capa 1: Rendering)
 *
 * Textarea auto-expandible con botón de enviar.
 * Enter envía, Shift+Enter agrega newline.
 */

import { appState } from '../lib/state.ts';

interface ChatInputOptions {
  onSend: (message: string) => void;
}

export function ChatInput(opts: ChatInputOptions): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-input-area';

  const inner = document.createElement('div');
  inner.className = 'chat-input-wrapper';

  const textarea = document.createElement('textarea');
  textarea.className = 'chat-input';
  textarea.placeholder = 'Escribe un mensaje...';
  textarea.rows = 1;

  // Auto-expand
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  });

  // Enter to send, Shift+Enter for newline
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  const sendBtn = document.createElement('button');
  sendBtn.className = 'chat-send-btn';
  sendBtn.textContent = '↑';
  sendBtn.addEventListener('click', send);

  // Disable during streaming
  appState.isStreaming.subscribe(streaming => {
    textarea.disabled = streaming;
    sendBtn.disabled = streaming;
  });

  function send() {
    const text = textarea.value.trim();
    if (!text) return;
    opts.onSend(text);
    textarea.value = '';
    textarea.style.height = 'auto';
  }

  inner.append(textarea, sendBtn);
  wrapper.append(inner);

  return wrapper;
}
