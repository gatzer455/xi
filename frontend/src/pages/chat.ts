/**
 * chat.ts — Página principal de chat (Capa 1 + Capa 3)
 *
 * Página central de la app: historial de mensajes + input.
 * Conectado con pi via pi-rpc.ts.
 */

import { appState } from '../lib/state.ts';
import { sendPrompt } from '../lib/pi/index.ts';
import { ChatBubble } from '../components/chat-bubble.ts';
import { ChatInput } from '../components/chat-input.ts';

export function ChatPage(): HTMLElement {
  const page = document.createElement('div');
  page.className = 'chat-area';

  // ═══ Header ═══
  const header = document.createElement('div');
  header.className = 'chat-header';

  const title = document.createElement('h1');
  title.className = 'chat-header-title';
  title.textContent = 'xi';
  header.append(title);

  const modelBadge = document.createElement('span');
  modelBadge.className = 'chat-header-model';
  modelBadge.textContent = 'sin modelo';
  appState.currentModel.subscribe(model => {
    modelBadge.textContent = model ? model.name : 'sin modelo';
  });
  header.append(modelBadge);

  page.append(header);

  // ═══ Messages ═══
  const messagesContainer = document.createElement('div');
  messagesContainer.className = 'chat-messages';

  const messagesInner = document.createElement('div');
  messagesInner.className = 'chat-messages-inner';

  function renderMessages(messages: typeof appState.messages.value) {
    messagesInner.replaceChildren();

    if (messages.length === 0) {
      const welcome = document.createElement('div');
      welcome.className = 'welcome';

      const icon = document.createElement('div');
      icon.className = 'welcome-icon';
      icon.textContent = '✦';
      welcome.append(icon);

      const welcomeTitle = document.createElement('h2');
      welcomeTitle.className = 'welcome-title';
      welcomeTitle.textContent = '¿En qué puedo ayudarte?';
      welcome.append(welcomeTitle);

      const subtitle = document.createElement('p');
      subtitle.className = 'welcome-subtitle';

      if (!appState.workingDir.value) {
        subtitle.textContent = 'Selecciona una carpeta de trabajo en el panel lateral para comenzar.';
      } else {
        subtitle.textContent = 'Escribe un mensaje para comenzar una conversación con pi.';
      }
      welcome.append(subtitle);

      messagesInner.append(welcome);
      return;
    }

    messages.forEach(msg => {
      messagesInner.append(ChatBubble(msg));
    });

    // Auto-scroll to bottom
    requestAnimationFrame(() => {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
  }

  appState.messages.subscribe(renderMessages);

  messagesContainer.append(messagesInner);
  page.append(messagesContainer);

  // ═══ Input ═══
  const input = ChatInput({
    onSend: async (text) => {
      if (!appState.workingDir.value) {
        // Si no hay carpeta seleccionada, no enviar
        return;
      }

      // Agregar mensaje del usuario al estado
      const userMsg = {
        id: crypto.randomUUID(),
        role: 'user' as const,
        content: text,
        timestamp: Date.now(),
      };
      appState.messages.value = [...appState.messages.value, userMsg];

      // Enviar a pi
      try {
        await sendPrompt(text);
      } catch (err) {
        console.error('Error sending prompt:', err);
      }
    },
  });
  page.append(input);

  return page;
}
