/**
 * tab-manager.ts — Estado y acciones del sistema de tabs.
 *
 * Capa separada de appState (lib/state.ts). Mientras que appState
 * representa el estado global de la app (pi, sesiones, settings),
 * este módulo gestiona exclusivamente las tabs VISUALES en la barra.
 *
 * Relación con appState:
 *   - Una tab de tipo 'chat' tiene un sessionId que refiere a
 *     appState.openTabs[]. Al activar esa tab, se llama a
 *     setActiveTab(sessionId) para que state-sync.ts siga
 *     ruteando eventos al store correcto.
 *   - El Explorer era antes un toggle (appState.explorerPanelOpen)
 *     y una vista (navigate('explorer')). Con tabs, es una tab
 *     singleton de tipo 'explorer'.
 *   - welcome, sessions, settings siguen usando appState.currentView
 *     directamente (no son tabs).
 */

import { createStore, produce } from 'solid-js/store';
import { createSignal } from 'solid-js';
import { appState, setActiveTab as setAppActiveTab } from 'xi-ui/lib/state.ts';
import { navigate } from 'xi-ui/lib/nav.ts';

// ═══════════════════════════════════════════════════════════
// Tipos
// ═══════════════════════════════════════════════════════════

export type TabType = 'chat' | 'explorer';

export interface Tab {
  id: string;
  type: TabType;
  label: string;
  /** Solo para type === 'chat': id de la Session en appState.openTabs. */
  sessionId?: string;
}

// ═══════════════════════════════════════════════════════════
// Store — module-level, convive con appState
// ═══════════════════════════════════════════════════════════

const [tabs, setTabs] = createStore<Tab[]>([]);
const [activeTabId, setActiveTabId] = createSignal<string | null>(null);

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

let counter = 0;
function uid(): string {
  return `tab-${++counter}-${Date.now().toString(36)}`;
}

// ═══════════════════════════════════════════════════════════
// Getters (para uso en componentes)
// ═══════════════════════════════════════════════════════════

/** Retorna el store de tabs reactivo. Usar con <For each={tabs}> */
export function getTabs(): Tab[] {
  return tabs;
}

/** ID de la tab activa. */
export function getActiveTabId(): string | null {
  return activeTabId();
}

/** La tab activa, o null si no hay. */
export function getActiveTab(): Tab | null {
  const id = activeTabId();
  if (!id) return null;
  return tabs.find(t => t.id === id) ?? null;
}

/** ¿Hay tabs abiertas? */
export function hasOpenTabs(): boolean {
  return tabs.length > 0;
}

// ═══════════════════════════════════════════════════════════
// Acciones
// ═══════════════════════════════════════════════════════════

/**
 * Abre una tab de chat para una sesión existente.
 * Si ya hay una tab con ese sessionId, solo la activa.
 */
export function openChatTab(sessionId: string, label?: string): string {
  // Si ya existe, activarla
  const existing = tabs.find(t => t.type === 'chat' && t.sessionId === sessionId);
  if (existing) {
    setActiveTabId(existing.id);
    setAppActiveTab(sessionId);
    navigate('chat');
    return existing.id;
  }

  const id = uid();
  setTabs(
    produce((draft) => {
      draft.push({ id, type: 'chat', label: label ?? sessionId.slice(0, 8), sessionId });
    })
  );
  setActiveTabId(id);
  setAppActiveTab(sessionId);
  navigate('chat');
  return id;
}

/**
 * Abre el Explorer como tab (singleton).
 * Si ya está abierto, lo activa.
 */
export function openExplorerTab(): string {
  const existing = tabs.find(t => t.type === 'explorer');
  if (existing) {
    setActiveTabId(existing.id);
    return existing.id;
  }

  const id = '__explorer__';
  setTabs(
    produce((draft) => {
      draft.push({ id, type: 'explorer', label: 'Explorador' });
    })
  );
  setActiveTabId(id);
  return id;
}

/**
 * Activa una tab existente por ID.
 * Si es de tipo 'chat', también setea la sesión activa en appState.
 */
export function activateTab(tabId: string): void {
  setActiveTabId(tabId);
  const tab = tabs.find(t => t.id === tabId);
  if (tab?.type === 'chat' && tab.sessionId) {
    setAppActiveTab(tab.sessionId);
  }
}

/**
 * Cierra una tab por ID.
 * Si es la activa, activa la adyacente más cercana.
 * Si no quedan tabs, navega a la vista anterior o welcome.
 */
export function closeTab(tabId: string): void {
  const idx = tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;

  const tab = tabs[idx];
  const wasActive = activeTabId() === tabId;

  // Remover del store
  setTabs(
    produce((draft) => {
      draft.splice(idx, 1);
    })
  );

  // Si era la activa, activar otra
  if (wasActive) {
    if (tabs.length > 0) {
      // tabs ya está actualizada por produce, el índice puede haber cambiado
      const next = tabs[idx] ?? tabs[idx - 1] ?? null;
      if (next) {
        setActiveTabId(next.id);
        if (next.type === 'chat' && next.sessionId) {
          setAppActiveTab(next.sessionId);
          navigate('chat');
        }
        return;
      }
    }
    // No quedan tabs
    setActiveTabId(null);
    const prev = appState.previousView.value;
    navigate(prev && prev !== 'chat' ? prev : 'welcome');
  }
}

/** Cierra la tab activa. */
export function closeActiveTab(): void {
  const id = activeTabId();
  if (id) closeTab(id);
}

/** Navega a la tab siguiente (ciclo). */
export function nextTab(): void {
  const id = activeTabId();
  if (!id || tabs.length < 2) return;
  const idx = tabs.findIndex(t => t.id === id);
  const next = tabs[(idx + 1) % tabs.length];
  if (next) activateTab(next.id);
}

/** Navega a la tab anterior (ciclo). */
export function prevTab(): void {
  const id = activeTabId();
  if (!id || tabs.length < 2) return;
  const idx = tabs.findIndex(t => t.id === id);
  const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
  if (prev) activateTab(prev.id);
}

/** Cierra todas las tabs. */
export function closeAllTabs(): void {
  setTabs(() => []);
  setActiveTabId(null);
}

// ═══════════════════════════════════════════════════════════
// Sincronización con appState
// ═══════════════════════════════════════════════════════════

/**
 * Sincroniza las tabs de chat con appState.openTabs.
 * Si se abre una sesión desde fuera del tab manager (SessionsPage),
 * este hook permite crear una tab para ella.
 */
export function syncChatTab(sessionId: string, label: string): string {
  const existing = tabs.find(t => t.type === 'chat' && t.sessionId === sessionId);
  if (existing) return existing.id;

  const id = uid();
  setTabs(
    produce((draft) => {
      draft.push({ id, type: 'chat', label, sessionId });
    })
  );
  return id;
}

/** Resetea el estado (útil en tests). */
export function resetTabState(): void {
  setTabs(() => []);
  setActiveTabId(null);
}
