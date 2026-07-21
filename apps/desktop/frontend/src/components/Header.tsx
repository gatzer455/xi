/**
 * Header.tsx — Top bar del app shell.
 *
 * Barra unificada: logo, proyecto, tabs de sesión, botón "+" para
 * historial, y settings. Las tabs de chat aparecen como fichas
 * clickeables; al lado de la última tab está el "+" (estilo Mozilla).
 *
 * El botón de explorer y "Nueva sesión" viven en SessionsPage, no acá.
 */
import { createSignal, For, onMount, onCleanup } from 'solid-js';
import { appState } from 'xi-ui/lib/state.ts';
import { navigate } from 'xi-ui/lib/nav.ts';
import { icon } from 'xi-ui/lib/icons.ts';
import { dropStore } from 'xi-ui/lib/chat/stores.ts';
import { pickAndOpenProject } from '../lib/workdir.ts';
import {
  getTabs,
  getActiveTabId,
  activateTab,
  closeTab,
  syncChatTab,
  openExplorerTab,
  nextTab,
  prevTab,
} from '../lib/tab-manager.ts';
import { abortPi } from '../lib/pi/index.ts';

// ─── Icon helper ─────────────────────────────────────────────

function IconEl(props: { name: string; size?: number }) {
  let ref: HTMLSpanElement | undefined;
  onMount(() => {
    if (ref) ref.append(icon(props.name, { size: props.size ?? 16 }));
  });
  return <span ref={ref} style={{ display: 'inline-flex', 'vertical-align': 'middle' }} />;
}

// ─── Tab helpers ─────────────────────────────────────────────

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

// ─── Atajos de teclado (window-level) ─────────────────────────

function useTabShortcuts() {
  onMount(() => {
    function handler(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        navigate('sessions');
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

// ─── Header ──────────────────────────────────────────────────

export function Header() {
  const [activeId, setActiveId] = createSignal(getActiveTabId());

  // Sync: cuando appState.openTabs cambia, crear UI tabs para las nuevas
  onMount(() => {
    onCleanup(appState.openTabs.subscribe((openTabs) => {
      for (const s of openTabs) {
        if (!getTabs().find(t => t.sessionId === s.id)) {
          syncChatTab(s.id, s.name ?? s.id.slice(0, 8));
        }
      }
    }));
  });

  // Trackear activeTabId del tab-manager con polling mínimo
  onMount(() => {
    const interval = setInterval(() => {
      const next = getActiveTabId();
      if (next !== activeId()) setActiveId(next);
    }, 50);
    onCleanup(() => clearInterval(interval));
  });

  useTabShortcuts();

  return (
    <div class="top-bar">
      <img class="top-bar-logo" src="/xi-icon.svg" alt="xi" width={28} height={28}
           style={{ cursor: 'pointer' }} title="Inicio"
           onClick={() => navigate('welcome')} />
      <ProjectCard />

      {/* Tabs de sesión + botón "+" estilo Mozilla */}
      <div class="top-bar-tabs">
        <For each={getTabs()}>
          {(tab) => (
            <div classList={{ 'top-bar-tab': true, 'top-bar-tab--active': tab.id === activeId() }}
                 onClick={() => activateTab(tab.id)}
                 onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTabWithCleanup(tab.id); } }}>
              <button class="top-bar-tab-label"
                      title={tab.label}>
                <span class="top-bar-tab-icon">
                  {tab.type === 'chat'
                    ? <IconEl name="message-square-plus" size={14} />
                    : <IconEl name="folder-tree" size={14} />}
                </span>
                <span class="top-bar-tab-text">{tab.label}</span>
              </button>
              <button class="top-bar-tab-close"
                      onClick={(e) => { e.stopPropagation(); closeTabWithCleanup(tab.id); }}
                      aria-label="Cerrar tab">×</button>
            </div>
          )}
        </For>
        {/* Botón "+" al lado de la última tab — abre historial de sesiones */}
        <button class="top-bar-plus-btn"
                onClick={() => navigate('sessions')}
                title="Nueva conversación / Historial (Ctrl+Shift+T)"
                aria-label="Historial de conversaciones">+</button>
      </div>

      {/* Settings a la derecha */}
      <button class="top-bar-settings-btn"
              onClick={() => navigate('settings')}
              title="Configuración (Ctrl+,)"
              aria-label="Configuración">
        <IconEl name="settings" size={16} />
      </button>
    </div>
  );
}

// ─── ProjectCard ─────────────────────────────────────────────

function ProjectCard() {
  const [dir, setDir] = createSignal(appState.workingDir.value);
  onCleanup(appState.workingDir.subscribe(setDir));

  return (
    <button class="top-bar-project"
            title={dir() ?? 'Haz click para seleccionar una carpeta de trabajo'}
            onClick={() => pickAndOpenProject().catch(console.error)}>
      {dir() ? dir()!.split('/').pop()! : 'Seleccionar proyecto'}
    </button>
  );
}
