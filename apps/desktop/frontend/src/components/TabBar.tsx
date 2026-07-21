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
import { createSignal, For, onMount, onCleanup } from 'solid-js';
import { appState } from 'xi-ui/lib/state.ts';
import { navigate } from 'xi-ui/lib/nav.ts';
import { icon } from 'xi-ui/lib/icons.ts';
import { dropStore } from 'xi-ui/lib/chat/stores.ts';
import {
  getTabs,
  getActiveTabId,
  activateTab,
  closeTab,
  openChatTab,
  openExplorerTab,
  nextTab,
  prevTab,
} from '../lib/tab-manager.ts';

// ─── Helper: abort si la tab que se cierra es la del streaming ───

import { abortPi } from '../lib/pi/index.ts';

function closeTabWithCleanup(tabId: string): void {
  const tab = getTabs().find(t => t.id === tabId);
  if (tab?.type === 'chat' && tab.sessionId) {
    if (tab.sessionId === getActiveTabId() && appState.isStreaming.value) {
      abortPi().catch(() => {});
    }
    dropStore(tab.sessionId);
  }
  closeTab(tabId);
}

// ─── Icon helper (SVG inline) ──────────────────────────────────────

function IconEl(props: { name: string; size?: number }) {
  let ref: HTMLSpanElement | undefined;
  onMount(() => {
    if (ref) ref.append(icon(props.name, { size: props.size ?? 16 }));
  });
  return <span ref={ref} style={{ display: 'inline-flex', 'vertical-align': 'middle' }} />;
}

// ─── Atajos de teclado (window-level) ─────────────────────────────

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

// ─── TabBar ─────────────────────────────────────────────────────────

export function TabBar() {
  // Signal reactiva para tabs (el store se trackea por getTabs() en JSX)
  // Refrescar cuando cambia activeTabId
  const [activeId, setActiveId] = createSignal(getActiveTabId());

  // Suscribirse a cambios del tab manager
  onMount(() => {
    // Polling no: usamos un efecto que se dispara cuando el componente se re-renderiza.
    // Como SolidJS es reactivo, las lecturas de getTabs() en JSX ya trackean.
    // Pero activeTabId es un createSignal externo — necesitamos polling o eventos.
    // Solución: exponer un subscribe desde tab-manager. Por ahora, un interval mínimo.
    // TODO: cambiar a evento/subscribe cuando tab-manager lo exponga.
    const interval = setInterval(() => {
      setActiveId(getActiveTabId());
    }, 100);

    onCleanup(() => clearInterval(interval));
  });

  function handleNewChat() {
    // Si hay workingDir, crear sesión. Si no, ir a welcome para que seleccione.
    if (appState.workingDir.value) {
      // navigate('chat') — ChatPage se encarga de crear sesión si no hay
      navigate('chat');
    } else {
      navigate('welcome');
    }
  }

  useTabShortcuts(handleNewChat);

  return (
    <div class="tab-bar" role="tablist">
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
                if (e.button === 1) { // middle-click
                  e.preventDefault();
                  closeTabWithCleanup(tab.id);
                }
              }}
            >
              <span class="tab-bar__tab-icon">
                {tab.type === 'chat' ? <IconEl name="chat-text" size={14} /> : <IconEl name="folder-tree" size={14} />}
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
          <IconEl name="plus-circle" size={16} />
        </button>
        <button class="tab-bar__btn" onClick={openExplorerTab}
                title="Explorador de archivos (Ctrl+Shift+E)"
                aria-label="Abrir explorador">
          <IconEl name="folder-tree" size={16} />
        </button>
        <button class="tab-bar__btn" onClick={() => navigate('sessions')}
                title="Historial de conversaciones"
                aria-label="Historial de sesiones">
          <IconEl name="clock-counter-clockwise" size={16} />
        </button>
        <button class="tab-bar__btn" onClick={() => navigate('settings')}
                title="Configuración"
                aria-label="Configuración">
          <IconEl name="gear" size={16} />
        </button>
      </div>
    </div>
  );
}
