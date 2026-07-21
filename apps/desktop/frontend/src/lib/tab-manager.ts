/**
 * tab-manager.ts — Estado y acciones del sistema de tabs y tiles.
 *
 * Capa separada de appState (lib/state.ts). Mientras que appState
 * representa el estado global de la app (pi, sesiones, settings),
 * este módulo gestiona exclusivamente las tabs VISUALES en la barra
 * y los tiles (splits) dentro de cada tab.
 *
 * Una tab puede tener múltiples tiles (splits). El label de la tab
 * se deriva del tile activo (como Ghostty).
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

export type SplitDir = 'horizontal' | 'vertical';

export interface Tile {
  id: string;
  type: TabType;
  label: string;
  /** Solo para type === 'chat': id de la Session en appState.openTabs. */
  sessionId?: string;
}

export interface TabLayout {
  direction: SplitDir | null;  // null = un solo tile
  sizes: number[];             // proporciones, sum(1), length = tiles.length
}

export interface Tab {
  id: string;
  /**
   * Sincronizado del tile activo. Se mantiene para backward
   * compat con código que lee tab.type directamente.
   */
  type: TabType;
  /**
   * Sincronizado del tile activo.
   */
  label: string;
  /**
   * Sincronizado del tile activo. undefined si el tile activo
   * no es de tipo 'chat'.
   */
  sessionId?: string;
  /** Tiles (splits) dentro de esta tab. */
  tiles: Tile[];
  /** ID del tile activo dentro de esta tab. */
  activeTileId: string;
  /** Layout de los tiles. */
  layout: TabLayout;
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

function tileUid(): string {
  return `tile-${++counter}-${Date.now().toString(36)}`;
}

/** Sincroniza los campos de nivel tab (type, label, sessionId)
 *  desde el tile activo. Se llama dentro de un bloque produce(). */
function syncTabFromActiveTile(draft: Tab): void {
  const tile = draft.tiles.find(t => t.id === draft.activeTileId);
  if (!tile) return;
  draft.type = tile.type;
  draft.label = tile.label;
  draft.sessionId = tile.sessionId;
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

/** El tile activo de la tab activa, o null. */
export function getActiveTile(): Tile | null {
  const tab = getActiveTab();
  if (!tab) return null;
  return tab.tiles.find(t => t.id === tab.activeTileId) ?? null;
}

/** El tile activo de una tab específica, o null. */
export function getActiveTileInTab(tabId: string): Tile | null {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return null;
  return tab.tiles.find(t => t.id === tab.activeTileId) ?? null;
}

/** ¿Hay tabs abiertas? */
export function hasOpenTabs(): boolean {
  return tabs.length > 0;
}

// ═══════════════════════════════════════════════════════════
// Acciones — Tabs
// ═══════════════════════════════════════════════════════════

/**
 * Abre una tab de chat para una sesión existente.
 * Si ya hay una tab con ese sessionId, solo la activa.
 */
export function openChatTab(sessionId: string, label?: string): string {
  const existing = tabs.find(t => t.type === 'chat' && t.sessionId === sessionId);
  if (existing) {
    setActiveTabId(existing.id);
    setAppActiveTab(sessionId);
    navigate('chat');
    return existing.id;
  }

  const id = uid();
  const tileId = tileUid();
  const tileLabel = label ?? sessionId.slice(0, 8);
  const tile: Tile = { id: tileId, type: 'chat', label: tileLabel, sessionId };

  setTabs(
    produce((draft) => {
      draft.push({
        id,
        type: 'chat',
        label: tileLabel,
        sessionId,
        tiles: [tile],
        activeTileId: tileId,
        layout: { direction: null, sizes: [1] },
      });
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
    navigate('explorer');
    return existing.id;
  }

  const id = '__explorer__';
  const tileId = 'tile-explorer';
  const tile: Tile = { id: tileId, type: 'explorer', label: 'Explorador' };

  setTabs(
    produce((draft) => {
      draft.push({
        id,
        type: 'explorer',
        label: 'Explorador',
        tiles: [tile],
        activeTileId: tileId,
        layout: { direction: null, sizes: [1] },
      });
    })
  );
  setActiveTabId(id);
  navigate('explorer');
  return id;
}

/**
 * Activa una tab existente por ID.
 * Si es de tipo 'chat', también setea la sesión activa en appState y navega a chat.
 */
export function activateTab(tabId: string): void {
  setActiveTabId(tabId);
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  const tile = tab.tiles.find(t => t.id === tab.activeTileId);
  if (tile?.type === 'chat' && tile.sessionId) {
    setAppActiveTab(tile.sessionId);
    navigate('chat');
  } else if (tile?.type === 'explorer') {
    navigate('explorer');
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

  const wasActive = activeTabId() === tabId;

  setTabs(
    produce((draft) => {
      draft.splice(idx, 1);
    })
  );

  if (wasActive) {
    if (tabs.length > 0) {
      const next = tabs[idx] ?? tabs[idx - 1] ?? null;
      if (next) {
        activateTab(next.id);
        return;
      }
    }
    setActiveTabId(null);
    const prev = appState.previousView.value;
    navigate(prev && prev !== 'chat' ? prev : 'welcome');
  }
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
// Acciones — Tiles (splits dentro de una tab)
// ═══════════════════════════════════════════════════════════

/**
 * Divide la tab en dos tiles. El nuevo tile se agrega al final
 * y se activa. El tipo por defecto es 'explorer' por ser el más
 * útil como split.
 */
export function splitTile(tabId: string, direction: SplitDir, tileType?: TabType): void {
  setTabs(
    produce((draft) => {
      const tab = draft.find(t => t.id === tabId);
      if (!tab) return;

      const tileId = tileUid();
      const newTile: Tile = {
        id: tileId,
        type: tileType ?? 'explorer',
        label: tileType === 'chat' ? 'Nuevo chat' : 'Explorador',
      };

      tab.tiles.push(newTile);
      const n = tab.tiles.length;
      tab.layout = { direction, sizes: Array(n).fill(1 / n) };
      tab.activeTileId = tileId;
      syncTabFromActiveTile(tab);
    })
  );
}

/** Cierra un tile dentro de una tab.
 *  Si es el último tile, cierra la tab completa.
 */
export function closeTile(tabId: string, tileId: string): void {
  setTabs(
    produce((draft) => {
      const tab = draft.find(t => t.id === tabId);
      if (!tab) return;
      if (tab.tiles.length <= 1) {
        // El único tile — no se cierra acá, el caller debe cerrar la tab
        return;
      }
      const idx = tab.tiles.findIndex(t => t.id === tileId);
      if (idx === -1) return;

      tab.tiles.splice(idx, 1);
      const n = tab.tiles.length;
      tab.layout = { direction: tab.layout.direction, sizes: Array(n).fill(1 / n) };

      // Si el tile cerrado era el activo, activar otro
      if (tab.activeTileId === tileId) {
        const next = tab.tiles[idx] ?? tab.tiles[idx - 1] ?? tab.tiles[0];
        tab.activeTileId = next.id;
        syncTabFromActiveTile(tab);
      }
    })
  );
}

/** Cierra el tile activo de la tab activa.
 *  Si es el único tile, cierra la tab completa. */
export function closeActiveTile(): void {
  const tabId = activeTabId();
  if (!tabId) return;
  const tab = getActiveTab();
  if (!tab) return;

  if (tab.tiles.length <= 1) {
    closeTab(tabId);
    return;
  }
  closeTile(tabId, tab.activeTileId);
}

/** Activa un tile específico dentro de una tab.
 *  Sincroniza tab.type, tab.label, tab.sessionId y appState. */
export function setActiveTile(tabId: string, tileId: string): void {
  setTabs(
    produce((draft) => {
      const tab = draft.find(t => t.id === tabId);
      if (!tab) return;
      if (!tab.tiles.find(t => t.id === tileId)) return;

      tab.activeTileId = tileId;
      syncTabFromActiveTile(tab);
    })
  );

  // Sincronizar appState para state-sync
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  const tile = tab.tiles.find(t => t.id === tileId);
  if (tile?.type === 'chat' && tile.sessionId) {
    setAppActiveTab(tile.sessionId);
    navigate('chat');
  } else if (tile?.type === 'explorer') {
    navigate('explorer');
  }
}

/** Navega al tile siguiente dentro de la tab activa (ciclo). */
export function nextTile(): void {
  const tabId = activeTabId();
  if (!tabId) return;
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || tab.tiles.length < 2) return;

  const idx = tab.tiles.findIndex(t => t.id === tab.activeTileId);
  const next = tab.tiles[(idx + 1) % tab.tiles.length];
  if (next) setActiveTile(tabId, next.id);
}

/** Navega al tile anterior dentro de la tab activa (ciclo). */
export function prevTile(): void {
  const tabId = activeTabId();
  if (!tabId) return;
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || tab.tiles.length < 2) return;

  const idx = tab.tiles.findIndex(t => t.id === tab.activeTileId);
  const prev = tab.tiles[(idx - 1 + tab.tiles.length) % tab.tiles.length];
  if (prev) setActiveTile(tabId, prev.id);
}

// ═══════════════════════════════════════════════════════════
// Sincronización con appState
// ═══════════════════════════════════════════════════════════

/** Crea una UI tab para una sesión si no existe ya. Retorna el id de la tab. */
export function syncChatTab(sessionId: string, label: string): string {
  const existing = tabs.find(t => t.type === 'chat' && t.sessionId === sessionId);
  if (existing) return existing.id;

  const id = uid();
  const tileId = tileUid();
  const tile: Tile = { id: tileId, type: 'chat', label, sessionId };

  setTabs(
    produce((draft) => {
      draft.push({
        id,
        type: 'chat',
        label,
        sessionId,
        tiles: [tile],
        activeTileId: tileId,
        layout: { direction: null, sizes: [1] },
      });
    })
  );
  return id;
}

/** Resetea el estado (útil en tests). */
export function resetTabState(): void {
  setTabs(() => []);
  setActiveTabId(null);
}
