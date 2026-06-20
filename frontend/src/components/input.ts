/**
 * input.ts — Barra de input del app shell browser-shaped (Capa 1).
 *
 * Textarea + botón de enviar, fijos abajo. Placeholder contextual:
 *   - Sin proyecto: "Selecciona un proyecto primero" (deshabilitado)
 *   - Con proyecto: "Escribe un mensaje..." (habilitado)
 *
 * Enter envía, Shift+Enter agrega newline. Auto-expand hasta 200px.
 * Deshabilitado durante streaming (pi generando respuesta).
 *
 * Reemplaza a chat-input.ts — misma lógica, nuevo layout (sin
 * .chat-input-wrapper, directo en .input-bar).
 */

import { appState } from '../lib/state.ts';
import { sendPrompt } from '../lib/pi/index.ts';
import { navigate } from '../lib/nav.ts';

export function InputBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'input-bar';

  const textarea = document.createElement('textarea');
  textarea.rows = 1;
  textarea.placeholder = 'Selecciona un proyecto primero';
  textarea.disabled = true;

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
  sendBtn.className = 'input-send-btn';
  sendBtn.textContent = '↵';
  sendBtn.disabled = true;
  sendBtn.addEventListener('click', send);

  // Habilitar/deshabilitar según sesión activa y streaming.
  // El input solo es visible cuando hay una sesión activa (tab abierta).
  const updateState = (): void => {
    const hasSession = appState.activeTabId.value !== null;
    const streaming = appState.isStreaming.value;
    const disabled = !hasSession || streaming;

    bar.style.display = hasSession ? '' : 'none';
    textarea.disabled = disabled;
    sendBtn.disabled = disabled;

    if (!hasSession) {
      textarea.placeholder = 'Selecciona una sesión primero';
    } else if (streaming) {
      textarea.placeholder = 'pi está respondiendo...';
    } else {
      textarea.placeholder = 'Escribe un mensaje...';
    }
  };

  updateState();
  appState.activeTabId.subscribe(updateState);
  appState.isStreaming.subscribe(updateState);

  bar.append(textarea, sendBtn);

  function send(): void {
    const text = textarea.value.trim();
    if (!text || !appState.workingDir.value) return;

    // Agregar mensaje del usuario al estado
    const userMsg = {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content: text,
      timestamp: Date.now(),
    };
    appState.messages.value = [...appState.messages.value, userMsg];

    // Si no estamos en vista chat, cambiar a chat para ver el mensaje.
    if (appState.currentView.value !== 'chat') {
      navigate('chat');
    }

    // Enviar a pi
    sendPrompt(text).catch((err) => {
      console.error('Error sending prompt:', err);
    });

    // Limpiar textarea
    textarea.value = '';
    textarea.style.height = 'auto';
  }

  return bar;
}
