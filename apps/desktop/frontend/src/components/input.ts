/**
 * input.ts — Barra de input del app shell.
 *
 * Textarea + botón que togglea entre Send y Stop según isStreaming:
 *   - isStreaming=false: botón "Enviar" (↵), habilitado si hay texto
 *   - isStreaming=true: botón "Detener" (■), habilitado, click aborta pi
 *
 * Enter envía, Shift+Enter newline. Auto-expand hasta 200px.
 *
 * Inspiración: Claude.ai — un solo slot, el botón cambia de icon y de
 * handler según el estado. Stop button al lado del Send.
 *
 * Reemplaza a chat-input.ts — misma lógica, nuevo layout.
 */

import { appState } from 'xi-ui/lib/state.ts';
import { sendPrompt, abortPi, beginStreamForSession, endStream, dispatchSlashCommand } from '../lib/pi/index.ts';
import { navigate } from 'xi-ui/lib/nav.ts';

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
      if (appState.isStreaming.value) {
        // En teoría no debería pasar porque el botón se transforma, pero
        // por si el usuario presiona Enter mientras streamea, no enviamos.
        return;
      }
      send();
    }
  });

  // ── Send/Stop toggle button ──
  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'input-send-btn';
  sendBtn.disabled = true;

  const sendIcon = document.createElement('span');
  sendIcon.className = 'input-btn-icon input-btn-icon--send';
  sendIcon.textContent = '↵';
  sendBtn.append(sendIcon);

  const stopIcon = document.createElement('span');
  stopIcon.className = 'input-btn-icon input-btn-icon--stop';
  stopIcon.textContent = '■';
  sendBtn.append(stopIcon);

  sendBtn.addEventListener('click', () => {
    if (appState.isStreaming.value) {
      abort();
    } else {
      send();
    }
  });

  // Update state según sesión activa y streaming
  const updateState = (): void => {
    const hasSession = appState.activeTabId.value !== null;
    const streaming = appState.isStreaming.value;
    const hasText = textarea.value.trim().length > 0;

    bar.style.display = hasSession ? '' : 'none';

    if (streaming) {
      // Modo stop
      sendBtn.classList.add('input-send-btn--stop');
      sendBtn.classList.remove('input-send-btn--send');
      sendBtn.disabled = false;
      textarea.disabled = true;
      textarea.placeholder = 'Trabajando…';
    } else {
      // Modo send
      sendBtn.classList.add('input-send-btn--send');
      sendBtn.classList.remove('input-send-btn--stop');
      sendBtn.disabled = !hasText || !appState.workingDir.value;
      textarea.disabled = !hasSession;
      textarea.placeholder = !hasSession
        ? 'Selecciona una sesión primero'
        : 'Escribe un mensaje…';
    }
  };

  // Habilitar send solo cuando hay texto
  textarea.addEventListener('input', updateState);
  updateState();

  appState.activeTabId.subscribe(updateState);
  appState.isStreaming.subscribe(updateState);
  appState.workingDir.subscribe(updateState);

  bar.append(textarea, sendBtn);

  function send(): void {
    const text = textarea.value.trim();
    if (!text || !appState.workingDir.value || appState.isStreaming.value) return;

    if (text.startsWith('/')) {
      // Slash command: despachar antes de enviar. El dispatcher
      // traduce builtins a RPC, valida extensión/skill/prompt contra
      // get_commands, o muestra feedback local. Devuelve 'prompt' si
      // hay que mandarlo como prompt común (pi lo expande).
      dispatchSlashCommand(text).then((outcome) => {
        if (outcome.kind === 'unknown') return;          // no limpiar, no enviar
        if (outcome.kind === 'handled') {
          textarea.value = '';
          textarea.style.height = 'auto';
          updateState();
          return;
        }
        // outcome.kind === 'prompt': caer a envío normal
        doSend(text);
      }).catch((err) => {
        console.error('Error dispatching slash command:', err);
      });
      return;
    }

    doSend(text);
  }

  function doSend(text: string): void {
    const tabId = appState.activeTabId.value;
    if (!tabId) return;

    if (appState.currentView.value !== 'chat') {
      navigate('chat');
    }

    // Reclamar el routing del stream para este tab ANTES de enviar,
    // para ganar la carrera contra un cambio de tab (D7). El mensaje
    // del user llega después vía `message_start` de pi — no agregamos
    // mensaje optimista para evitar duplicación al reconciliar agent_end.
    beginStreamForSession(tabId);

    sendPrompt(text).then(() => {
      textarea.value = '';
      textarea.style.height = 'auto';
      updateState();
    }).catch((err) => {
      console.error('Error sending prompt:', err);
      endStream();
    });
  }

  function abort(): void {
    abortPi().catch((err) => {
      console.error('Error aborting pi:', err);
    });
  }

  return bar;
}
