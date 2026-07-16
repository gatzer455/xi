/**
 * input-bar.ts — Barra de input (mobile).
 *
 * Adaptado de apps/desktop/frontend/src/components/input.ts: misma
 * lógica send/stop toggle, solo cambian los imports (directo a
 * xi-ui/lib/pi/tauri-commands.ts + state-sync.ts en vez de la fachada
 * desktop lib/pi/index.ts, que no existe acá).
 */
import { appState } from 'xi-ui/lib/state.ts';
import { sendPrompt, abortPi } from 'xi-ui/lib/pi/tauri-commands.ts';
import { beginStreamForSession, endStream } from 'xi-ui/lib/pi/state-sync.ts';
import { navigate } from 'xi-ui/lib/nav.ts';

export function InputBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'input-bar';

  const textarea = document.createElement('textarea');
  textarea.rows = 1;
  textarea.placeholder = 'Selecciona un proyecto primero';
  textarea.disabled = true;

  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (appState.isStreaming.value) return;
      send();
    }
  });

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

  const updateState = (): void => {
    const hasSession = appState.activeTabId.value !== null;
    const streaming = appState.isStreaming.value;
    const hasText = textarea.value.trim().length > 0;

    bar.style.display = hasSession ? '' : 'none';

    if (streaming) {
      sendBtn.classList.add('input-send-btn--stop');
      sendBtn.classList.remove('input-send-btn--send');
      sendBtn.disabled = false;
      textarea.disabled = true;
      textarea.placeholder = 'Trabajando…';
    } else {
      sendBtn.classList.add('input-send-btn--send');
      sendBtn.classList.remove('input-send-btn--stop');
      sendBtn.disabled = !hasText || !appState.workingDir.value;
      textarea.disabled = !hasSession;
      textarea.placeholder = !hasSession
        ? 'Selecciona una sesión primero'
        : 'Escribe un mensaje…';
    }
  };

  textarea.addEventListener('input', updateState);
  updateState();

  appState.activeTabId.subscribe(updateState);
  appState.isStreaming.subscribe(updateState);
  appState.workingDir.subscribe(updateState);

  bar.append(textarea, sendBtn);

  function send(): void {
    const text = textarea.value.trim();
    if (!text || !appState.workingDir.value || appState.isStreaming.value) return;

    const tabId = appState.activeTabId.value;
    if (!tabId) return;

    if (appState.currentView.value !== 'chat') {
      navigate('chat');
    }

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
