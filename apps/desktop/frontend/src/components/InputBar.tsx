/**
 * InputBar.tsx — Barra de input con textarea + Send/Stop.
 */
import { createSignal, createEffect, onCleanup, onMount } from 'solid-js';
import { appState } from 'xi-ui/lib/state.ts';
import { sendPrompt, abortPi, beginStreamForSession, endStream, dispatchSlashCommand } from '../lib/pi/index.ts';
import { navigate } from 'xi-ui/lib/nav.ts';
import { SlashMenu } from 'xi-ui/components/slash-menu.ts';
import type { SlashMenuItem } from 'xi-ui/components/slash-menu.ts';
import { getAllSlashCommands } from 'xi-ui/lib/pi/slash-commands.ts';

export function InputBar(props?: { sessionId?: string }) {
  let textareaRef: HTMLTextAreaElement | undefined;
  let sendBtnRef: HTMLButtonElement | undefined;
  let barRef: HTMLDivElement | undefined;
  let slashMenu: ReturnType<typeof SlashMenu> | undefined;
  let dispatchInFlight = false;

  // Prop fijo para modo panel (no escucha cambios de activeTabId global)
  const fixedSessionId = () => props?.sessionId;

  // Estado reactivo desde signals vanilla
  const [hasSession, setHasSession] = createSignal(
    fixedSessionId() !== undefined || appState.activeTabId.value !== null
  );
  const [streaming, setStreaming] = createSignal(appState.isStreaming.value);
  const [hasWd, setHasWd] = createSignal(!!appState.workingDir.value);

  if (fixedSessionId() === undefined) {
    onCleanup(appState.activeTabId.subscribe((v) => setHasSession(v !== null)));
  }
  onCleanup(appState.isStreaming.subscribe(setStreaming));
  onCleanup(appState.workingDir.subscribe((v) => setHasWd(!!v)));

  // Input handler: auto-expand + slash menu
  function onInput() {
    const ta = textareaRef!;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';

    const text = ta.value.trimStart();
    if (!slashMenu) return;
    if (text.startsWith('/') && text.indexOf(' ') === -1) {
      const items = getAllSlashCommands();
      if (slashMenu.visible) slashMenu.update(items, text.slice(1));
      else slashMenu.open(items, text.slice(1));
    } else {
      slashMenu.close();
    }
    updateBtn();
  }

  function onKeyDown(e: KeyboardEvent) {
    const ta = textareaRef!;
    if (slashMenu?.visible) {
      if (e.key === 'Escape') { slashMenu.close(); e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'ArrowDown') { slashMenu.moveDown(); e.preventDefault(); return; }
      if (e.key === 'ArrowUp') { slashMenu.moveUp(); e.preventDefault(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); slashMenu.selectHighlighted(); return; }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (streaming()) return;
      send();
    }
  }

  function updateBtn() {
    if (!sendBtnRef || !textareaRef) return;
    const hasText = textareaRef.value.trim().length > 0;
    if (streaming()) {
      sendBtnRef.classList.add('input-send-btn--stop');
      sendBtnRef.classList.remove('input-send-btn--send');
      sendBtnRef.disabled = false;
    } else {
      sendBtnRef.classList.add('input-send-btn--send');
      sendBtnRef.classList.remove('input-send-btn--stop');
      sendBtnRef.disabled = !hasText || !hasWd();
    }
  }

  function send() {
    const ta = textareaRef!;
    const text = ta.value.trim();
    if (!text || !hasWd() || streaming()) return;

    if (text.startsWith('/')) {
      if (dispatchInFlight) return;
      dispatchInFlight = true;
      dispatchSlashCommand(text).then((outcome) => {
        dispatchInFlight = false;
        if (outcome.kind === 'unknown') return;
        if (outcome.kind === 'handled') {
          ta.value = '';
          ta.style.height = 'auto';
          updateBtn();
          return;
        }
        doSend(text);
      }).catch((err) => {
        dispatchInFlight = false;
        console.error('Error dispatching slash command:', err);
      });
      return;
    }
    doSend(text);
  }

  function doSend(text: string) {
    const tabId = fixedSessionId() ?? appState.activeTabId.value;
    if (!tabId) return;
    if (appState.currentView.value !== 'chat') navigate('chat');
    beginStreamForSession(tabId);
    sendPrompt(text).then(() => {
      textareaRef!.value = '';
      textareaRef!.style.height = 'auto';
      updateBtn();
    }).catch((err) => {
      console.error('Error sending prompt:', err);
      endStream();
    });
  }

  function abort() {
    abortPi().catch(console.error);
  }

  function onSlashSelect(item: SlashMenuItem) {
    const ta = textareaRef!;
    ta.value = `/${item.name} `;
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Efecto: actualizar estado visual
  createEffect(() => {
    const s = streaming();
    const hs = hasSession();
    const ta = textareaRef;
    if (!ta) return;
    if (s) {
      ta.disabled = true;
      ta.placeholder = 'Trabajando…';
    } else {
      ta.disabled = !hs;
      ta.placeholder = !hs ? 'Selecciona una sesión primero' : 'Escribe un mensaje…';
    }
    updateBtn();
  });

  // Global Esc para abortar (textarea disabled no captura keydown)
  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && streaming()) abort();
    };
    document.addEventListener('keydown', handler);
    onCleanup(() => document.removeEventListener('keydown', handler));

    // Slash menu
    slashMenu = SlashMenu(onSlashSelect);
    if (barRef) barRef.append(slashMenu.el);

    // Click outside para cerrar menú
    const clickHandler = (e: MouseEvent) => {
      if (!slashMenu?.visible || !textareaRef) return;
      const target = e.target as Node;
      if (!slashMenu.el.contains(target) && target !== textareaRef) {
        slashMenu.close();
      }
    };
    document.addEventListener('click', clickHandler);
    onCleanup(() => document.removeEventListener('click', clickHandler));
  });

  return (
    <div ref={barRef} class="input-bar">
      <textarea ref={textareaRef} rows={1}
                placeholder="Selecciona un proyecto primero" disabled={true}
                onInput={onInput} onKeyDown={onKeyDown} />
      <button ref={sendBtnRef} type="button" class="input-send-btn" disabled={true}
              onClick={() => streaming() ? abort() : send()}>
        <span class="input-btn-icon input-btn-icon--send">↵</span>
        <span class="input-btn-icon input-btn-icon--stop">■</span>
      </button>
    </div>
  );
}
