/**
 * TabBar.tsx — Barra de tabs del app shell.
 *
 * Reemplaza las funciones Tabs() + SettingsBtn() de Header.tsx.
 *
 * Atajos de teclado window-level (no necesitan dep extra):
 *   Ctrl+Shift+T  → Nueva conversación
 *   Ctrl+W        → Cerrar tab activa
 *   Ctrl+PageDown → Siguiente tab
 *   Ctrl+PageUp   → Tab anterior
 *   Ctrl+Shift+E  → Abrir/activar Explorer
 */
import { createSignal, For, createEffect, onMount, onCleanup } from 'solid-js';
import { appState } from 'xi-ui/lib/state.ts';
import { navigate } from 'xi-ui/lib/nav.ts';
import { icon } from 'xi-ui/lib/icons.ts';
import { dropStore } from 'xi-ui/lib/chat/stores.ts';
import {
  getTabs,
  getActiveTabId,
  activateTab,
  closeTab,
  openExplorerTab,
  nextTab,
  prevTab,
  syncChatTab,
} from '../lib/tab-manager.ts';
import { abortPi } from '../lib/pi/index.ts';

// ─── Helper: cerrar tab con side effects ──────────────────────

function closeTabWithCleanup(tabId: string): void {
  const tab = getTabs().find(t => t.id === tabId);
  if (tab?.type === 'chat' && tab.sessionId) {
    if (tab.sessionId === appState.activeTabId.value && appState.isStreaming.value) {
      abortPi().catch(() => {});
    }
    dropStore(tab.sessionId);
  }
  closeTab(tabId);
}

// ─── Icon helper (SVG inline) ─────────────────────────────────

function IconEl(props: { name: string; size?: number }) {
  let ref: HTMLSpanElement | undefined;
  onMount(() => {
    if (ref) ref.append(icon(props.name, { size: props.size ?? 16 }));
  });
  return <span ref={ref} style={{ display: 'inline-flex', 'vertical-align': 'middle' }} />;
}

// ─── Atajos de teclado (window-level) ─────────────────────────

function useTabShortcuts(onNewChat: () => void) {
  onMount(() => {
    function handler(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        onNewChat();
        return;
      }
      if (ctrl && e.key === 'w') {
        e.preventDefault();
        const id = getActiveTabId();
        if (id) closeTabWithCleanup(id);
        return;
      }
      if (ctrl && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        openExplorerTab();
        return;
      }
      if (ctrl && e.key === 'PageDown') {
        e.preventDefault();
        nextTab();
        return;
      }
      if (ctrl && e.key === 'PageUp') {
        e.preventDefault();
        prevTab();
        return;
      }
    }

    document.addEventListener('keydown', handler);
    onCleanup(() => document.removeEventListener('keydown', handler));
  });
}

// ─── Iconos disponibles (los que existen en icons.ts) ─────────
//   folder, folder-open, folder-tree, message-square-plus, file,
//   file-text, file-code, file-json, settings, chevron-right,
//   chevron-down, pencil, trash-2

// ─── TabBar ───────────────────────────────────────────────────

export function TabBar() {
  const [activeId, setActiveId] = createSignal(getActiveTabId());

  // Sync: cuando appState.openTabs cambia (desde SessionsPage),
  // crear una UI tab para cada sesión que no tenga una.
  onMount(() => {
    onCleanup(appState.openTabs.subscribe((openTabs) => {
      for (const s of openTabs) {
        if (!getTabs().find(t => t.sessionId === s.id)) {
          syncChatTab(s.id, s.name ?? s.id.slice(0, 8));
        }
      }
    }));
  });

  // Trackear activeTabId del tab-manager (createSignal externo)
  // usando un pequeño hack: re-encolar lectura en cada microtask.
  // SolidJS no puede trackear createSignal de otro módulo sin
  // que esté dentro de un tracking scope.
  onMount(() => {
    const interval = setInterval(() => {
      const next = getActiveTabId();
      if (next !== activeId()) setActiveId(next);
    }, 50);
    onCleanup(() => clearInterval(interval));
  });

  function handleNewChat() {
    if (appState.workingDir.value) {
      navigate('chat');
    } else {
      navigate('welcome');
    }
  }

  useTabShortcuts(handleNewChat);

  return (
    <div class="tab-bar" role="tablist" id="tab-bar-root">
      <div class="tab-bar__tabs">
        <For each={getTabs()}>
          {(tab) => (
            <button
              class="tab-bar__tab"
              classList={{ 'tab-bar__tab--active': tab.id === activeId() }}
              role="tab"
              aria-selected={tab.id === activeId()}
              onClick={() => activateTab(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTabWithCleanup(tab.id);
                }
              }}
            >
              <span class="tab-bar__tab-icon">
                {tab.type === 'chat'
                  ? <IconEl name="message-square-plus" size={14} />
                  : <IconEl name="folder-tree" size={14} />}
              </span>
              <span class="tab-bar__tab-label">{tab.label}</span>
              <span
                class="tab-bar__tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTabWithCleanup(tab.id);
                }}
                aria-label={`Cerrar ${tab.label}`}
                role="button"
                tabIndex={-1}
              >×</span>
            </button>
          )}
        </For>
      </div>
      <div class="tab-bar__actions">
        <button class="tab-bar__btn" onClick={handleNewChat}
                title="Nueva conversación (Ctrl+Shift+T)"
                aria-label="Nueva conversación">
          +
        </button>
        <button class="tab-bar__btn" onClick={openExplorerTab}
                title="Explorador de archivos (Ctrl+Shift+E)"
                aria-label="Abrir explorador">
          <IconEl name="folder-tree" size={16} />
        </button>
        <button class="tab-bar__btn" onClick={() => navigate('sessions')}
                title="Historial de conversaciones"
                aria-label="Historial de sesiones">
          🕐
        </button>
        <button class="tab-bar__btn" onClick={() => navigate('settings')}
                title="Configuración"
                aria-label="Configuración">
          <IconEl name="settings" size={16} />
        </button>
      </div>
    </div>
  );
}
