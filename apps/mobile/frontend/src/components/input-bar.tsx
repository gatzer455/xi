/**
 * input-bar.tsx — Barra de input (mobile).
 *
 * Adaptado de apps/desktop/frontend/src/components/InputBar.tsx:
 * sin slash commands, sin pane mode, sin context bar.
 */
import { createSignal, createEffect, onCleanup } from 'solid-js';
import { appState } from 'xi-ui/lib/state.ts';
import { sendPrompt, abortPi } from 'xi-ui/lib/pi/tauri-commands.ts';
import { beginStreamForSession, endStream } from 'xi-ui/lib/pi/state-sync.ts';
import { navigate } from 'xi-ui/lib/nav.ts';

export function InputBar() {
  let textareaRef: HTMLTextAreaElement | undefined;
  let sendBtnRef: HTMLButtonElement | undefined;
  let barRef: HTMLDivElement | undefined;

  const [hasSession, setHasSession] = createSignal(appState.activeTabId.value !== null);
  const [streaming, setStreaming] = createSignal(appState.isStreaming.value);
  const [hasWd, setHasWd] = createSignal(!!appState.workingDir.value);
  const [hasText, setHasText] = createSignal(false);

  onCleanup(appState.activeTabId.subscribe((v) => setHasSession(v !== null)));
  onCleanup(appState.isStreaming.subscribe(setStreaming));
  onCleanup(appState.workingDir.subscribe((v) => setHasWd(!!v)));

  function onInput() {
    const ta = textareaRef!;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    setHasText(ta.value.trim().length > 0);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (streaming()) return;
      send();
    }
  }

  function send() {
    const text = textareaRef!.value.trim();
    if (!text || !hasWd() || streaming()) return;

    const tabId = appState.activeTabId.value;
    if (!tabId) return;

    if (appState.currentView.value !== 'chat') {
      navigate('chat');
    }

    beginStreamForSession(tabId);
    sendPrompt(text)
      .then(() => {
        textareaRef!.value = '';
        textareaRef!.style.height = 'auto';
        setHasText(false);
      })
      .catch((err) => {
        console.error('Error sending prompt:', err);
        endStream();
      });
  }

  function abort() {
    abortPi().catch((err) => console.error('Error aborting pi:', err));
  }

  return (
    <div ref={barRef} class="input-bar" style={{ display: hasSession() ? '' : 'none' }}>
      <textarea
        ref={textareaRef}
        rows={1}
        placeholder={!hasSession() ? 'Selecciona una sesión primero' : 'Escribe un mensaje…'}
        disabled={streaming() || !hasSession()}
        onInput={onInput}
        onKeyDown={onKeyDown}
      />
      <button
        ref={sendBtnRef}
        type="button"
        class="input-send-btn"
        disabled={(!hasText() || !hasWd()) && !streaming()}
        onClick={streaming() ? abort : send}
      >
        <span
          class="input-btn-icon"
          classList={{
            'input-btn-icon--send': !streaming(),
            'input-btn-icon--stop': streaming(),
          }}
        >
          {streaming() ? '■' : '↵'}
        </span>
      </button>
    </div>
  );
}
