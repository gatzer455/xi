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
import { SlashMenu } from 'xi-ui/components/slash-menu.ts';
import type { SlashMenuItem } from 'xi-ui/components/slash-menu.ts';
import { getAllSlashCommands } from 'xi-ui/lib/pi/slash-commands.ts';

export function InputBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'input-bar';

  const textarea = document.createElement('textarea');
  textarea.rows = 1;
  textarea.placeholder = 'Selecciona un proyecto primero';
  textarea.disabled = true;

  // Auto-expand + slash menu filter
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';

    // Slash menu: mostrar/filtrar/ocultar según el texto.
    // trimStart (no trim) para no borrar el espacio después del nombre
    // del comando — ese espacio indica "ya terminé, vienen los args".
    const text = textarea.value.trimStart();
    if (text.startsWith('/') && text.indexOf(' ') === -1) {
      // Solo mostramos mientras el usuario escribe el nombre del comando
      // (antes del primer espacio). Después del espacio es el argumento.
      const items = getAllSlashCommands();
      if (slashMenu.visible) {
        slashMenu.update(items, text.slice(1));
      } else {
        slashMenu.open(items, text.slice(1));
      }
    } else {
      slashMenu.close();
    }
  });

  // Enter / Esc — con menú de autocomplete y abort por Esc
  //
  // El textarea se deshabilita durante streaming (updateState), así que
  // keydown no llega cuando más necesitamos Esc. Por eso el handler de
  // Esc para abortar va en document; el textarea solo maneja el menú.
  textarea.addEventListener('keydown', (e) => {
    // Slash menu visible: navegar o seleccionar
    if (slashMenu.visible) {
      if (e.key === 'Escape') { slashMenu.close(); e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'ArrowDown') { slashMenu.moveDown(); e.preventDefault(); return; }
      if (e.key === 'ArrowUp') { slashMenu.moveUp(); e.preventDefault(); return; }
      if (e.key === 'Enter') { e.preventDefault(); slashMenu.selectHighlighted(); return; }
      if (e.key === 'Tab') { e.preventDefault(); slashMenu.selectHighlighted(); return; }
      // Cualquier otra tecla: dejar pasar para filtrar.
      return;
    }

    // Enter para enviar
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (appState.isStreaming.value) return;
      send();
    }
  });

  // Global Esc: el textarea está disabled durante streaming, así que
  // el keydown no burbujea desde él. Escuchamos en document para que
  // Esc funcione siempre. El stopPropagation del menú evita que un
  // mismo Esc cierre el menú Y aborte.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && appState.isStreaming.value) {
      abort();
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

  // ── Slash menu (autocomplete dropdown) ────────────────────────

  const slashMenu = SlashMenu(onSlashSelect);
  bar.append(slashMenu.el);

  // Cerrar el menú al hacer click fuera (textarea o menú).
  // No usamos blur del textarea porque colisiona con el mousedown
  // del menú (el preventDefault del item no evita el blur).
  document.addEventListener('click', (e) => {
    if (!slashMenu.visible) return;
    const target = e.target as Node;
    if (!slashMenu.el.contains(target) && target !== textarea) {
      slashMenu.close();
    }
  });

  function onSlashSelect(item: SlashMenuItem): void {
    textarea.value = `/${item.name} `;
    textarea.focus();
    // Disparar 'input' para que el listener existente auto-expanda,
    // actualice el send button, y cierre el menú (el valor ahora
    // incluye espacio → la condición de la línea 43 cierra el menú).
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  }

  // ── Send/Stop guards ────────────────────────────────────────
  // dispatchSlashCommand es async y no setea isStreaming hasta que
  // resuelve, así que un doble Enter/click rápido re-entraría a send()
  // y dispararía dos veces comandos no idempotentes (/bash, /new, /clone).
  let dispatchInFlight = false;

  function send(): void {
    const text = textarea.value.trim();
    if (!text || !appState.workingDir.value || appState.isStreaming.value) return;

    if (text.startsWith('/')) {
      // Slash command: despachar antes de enviar. El dispatcher
      // traduce builtins a RPC, valida extensión/skill/prompt contra
      // get_commands, o muestra feedback local. Devuelve 'prompt' si
      // hay que mandarlo como prompt común (pi lo expande).
      if (dispatchInFlight) return;
      dispatchInFlight = true;
      dispatchSlashCommand(text).then((outcome) => {
        dispatchInFlight = false;
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
        dispatchInFlight = false;
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
