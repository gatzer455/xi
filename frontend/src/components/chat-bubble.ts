/**
 * chat-bubble.ts — Componente de burbuja de chat (Capa 1: Rendering)
 *
 * Renderiza un mensaje del usuario o del asistente.
 * Cada burbuja es autocontenida: avatar + contenido + tool calls.
 */

import type { ChatMessage } from '../lib/state.ts';

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

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble' + (message.isStreaming ? ' streaming' : '');
  bubble.textContent = message.content;
  content.append(bubble);

  // ═══ Tool calls (si hay) ═══
  if (message.toolCalls && message.toolCalls.length > 0) {
    message.toolCalls.forEach(tc => {
      const toolCall = document.createElement('div');
      toolCall.className = 'tool-call';

      const header = document.createElement('div');
      header.className = 'tool-call-header';
      header.addEventListener('click', () => {
        toolCall.classList.toggle('expanded');
      });

      const icon = document.createElement('span');
      icon.className = 'tool-call-icon';
      icon.textContent = '⚡';
      header.append(icon);

      const name = document.createElement('span');
      name.className = 'tool-call-name';
      name.textContent = tc.name;
      header.append(name);

      const args = document.createElement('span');
      args.textContent = JSON.stringify(tc.arguments).slice(0, 60);
      header.append(args);

      const status = document.createElement('span');
      status.className = `tool-call-status ${tc.result ? (tc.isError ? 'error' : 'done') : 'running'}`;
      status.textContent = tc.result ? (tc.isError ? '✗' : '✓') : '●';
      header.append(status);

      toolCall.append(header);

      if (tc.result) {
        const body = document.createElement('div');
        body.className = 'tool-call-body';
        body.textContent = tc.result;
        toolCall.append(body);
      }

      content.append(toolCall);
    });
  }

  wrapper.append(content);

  return wrapper;
}
