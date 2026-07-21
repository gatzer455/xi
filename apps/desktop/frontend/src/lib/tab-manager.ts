/**
 * tab-manager.ts — Tree-based tile system (Ghostty-inspired).
 *
 * Cada tab tiene un árbol binario de tiles (TileNode). Cada hoja
 * es un tile independiente (chat o explorer). Cada split divide en
 * dos (horizontal o vertical) con proporción 50/50.
 *
 * Operaciones: splitLeaf, removeLeaf, setFocus.
 * El label de la tab se deriva de la hoja con foco.
 *
 * Relación con appState:
 *   - Una hoja de tipo 'chat' tiene un sessionId que refiere a
 *     appState.openTabs[].
 *   - El Explorer es una tab singleton de tipo 'explorer'.
 *   - welcome, sessions, settings siguen usando appState.currentView.
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

/** Datos de una hoja (tile individual). */
export interface Tile {
  id: string;
  type: TabType;
  label: string;
  /** Solo para type === 'chat': id de la Session en appState.openTabs. */
  sessionId?: string;
}

/**
 * Árbol binario de tiles.
 *
 *   Leaf = un tile (chat o explorer).
 *   Split = divide el espacio en dos con proporción ratio (0-1).
 */
export type TileNode =
  | (Tile & { kind: 'leaf' })
  | { kind: 'split'; direction: SplitDir; ratio: number; left: TileNode; right: TileNode };

export interface Tab {
  id: string;
  /** Sincronizado de la hoja con foco. */
  type: TabType;
  /** Sincronizado de la hoja con foco. */
  label: string;
  /** Sincronizado de la hoja con foco. undefined si explorer. */
  sessionId?: string;
  /** Raíz del árbol de tiles. */
  root: TileNode;
  /** ID de la hoja con foco. */
  focus: string;
}

// ═══════════════════════════════════════════════════════════
// Store
// ═══════════════════════════════════════════════════════════

const [tabs, setTabs] = createStore<Tab[]>([]);
const [activeTabId, setActiveTabId] = createSignal<string | null>(null);

// ═══════════════════════════════════════════════════════════
// Helpers — Árbol
// ═══════════════════════════════════════════════════════════

let counter = 0;
function uid(): string { return `tab-${++counter}-${Date.now().toString(36)}`; }
function leafUid(): string { return `tile-${++counter}-${Date.now().toString(36)}`; }

function createLeaf(type: TabType, label: string, sessionId?: string): TileNode & { kind: 'leaf' } {
  return { kind: 'leaf', id: leafUid(), type, label, sessionId };
}

/** Busca una hoja por ID en el árbol. */
export function findLeaf(node: TileNode, leafId: string): (TileNode & { kind: 'leaf' }) | null {
  if (node.kind === 'leaf') return node.id === leafId ? node : null;
  return findLeaf(node.left, leafId) ?? findLeaf(node.right, leafId);
}

/** Retorna todas las hojas del árbol (orden DFS). */
export function getAllLeaves(node: TileNode): Tile[] {
  if (node.kind === 'leaf') return [node];
  return [...getAllLeaves(node.left), ...getAllLeaves(node.right)];
}

export function leafCount(node: TileNode): number {
  if (node.kind === 'leaf') return 1;
  return leafCount(node.left) + leafCount(node.right);
}

/** Aplica fn a la hoja con leafId, manteniendo el resto del árbol intacto. */
function mapLeaf(
  node: TileNode,
  leafId: string,
  fn: (leaf: TileNode & { kind: 'leaf' }) => TileNode,
): TileNode {
  if (node.kind === 'leaf') return node.id === leafId ? fn(node) : node;
  return {
    ...node,
    left: mapLeaf(node.left, leafId, fn),
    right: mapLeaf(node.right, leafId, fn),
  };
}

/** Envuelve la hoja focusId en un Split con newLeaf a la derecha/abajo. */
function splitNode(
  root: TileNode,
  focusId: string,
  direction: SplitDir,
  newLeaf: TileNode,
): TileNode {
  return mapLeaf(root, focusId, (existing) => ({
    kind: 'split',
    direction,
    ratio: 0.5,
    left: existing,
    right: newLeaf,
  }));
}

/** Elimina la hoja leafId del árbol. Colapsa el split padre si queda un solo hijo.
 *  Retorna null si el árbol queda vacío (única hoja). */
function removeNode(root: TileNode, leafId: string): TileNode | null {
  if (root.kind === 'leaf') return root.id === leafId ? null : root;

  const nL = removeNode(root.left, leafId);
  const nR = removeNode(root.right, leafId);

  if (nL === root.left && nR === root.right) return root; // no encontrada
  if (nL === null && nR === null) return null;
  if (nL === null) return nR!;   // colapsar split → hijo sobreviviente
  if (nR === null) return nL!;   // colapsar split → hijo sobreviviente
  return { ...root, left: nL, right: nR };
}

/** Retorna el id de una hoja cualquiera (para focus después de remover). */
function firstLeafId(node: TileNode): string {
  if (node.kind === 'leaf') return node.id;
  return firstLeafId(node.left);
}

/** Sincroniza tab.type, tab.label, tab.sessionId desde la hoja con foco. */
function syncFromFocus(draft: Tab): void {
  const leaf = findLeaf(draft.root, draft.focus);
  if (leaf) {
    draft.type = leaf.type;
    draft.label = leaf.label;
    draft.sessionId = leaf.sessionId;
  }
}

// ═══════════════════════════════════════════════════════════
// Getters
// ═══════════════════════════════════════════════════════════

export function getTabs(): Tab[] { return tabs; }
export function getActiveTabId(): string | null { return activeTabId(); }

export function getActiveTab(): Tab | null {
  const id = activeTabId();
  if (!id) return null;
  return tabs.find(t => t.id === id) ?? null;
}

export function getActiveTile(): Tile | null {
  const tab = getActiveTab();
  if (!tab) return null;
  return findLeaf(tab.root, tab.focus);
}

export function getActiveTileInTab(tabId: string): Tile | null {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return null;
  return findLeaf(tab.root, tab.focus);
}

export function hasOpenTabs(): boolean { return tabs.length > 0; }

export function tabHasMultipleLeaves(tabId: string): boolean {
  const tab = tabs.find(t => t.id === tabId);
  return tab ? leafCount(tab.root) > 1 : false;
}

// ═══════════════════════════════════════════════════════════
// Acciones — Tabs
// ═══════════════════════════════════════════════════════════

export function openChatTab(sessionId: string, label?: string): string {
  const existing = tabs.find(t => t.type === 'chat' && t.sessionId === sessionId);
  if (existing) {
    setActiveTabId(existing.id);
    setAppActiveTab(sessionId);
    navigate('chat');
    return existing.id;
  }

  const id = uid();
  const leaf = createLeaf('chat', label ?? sessionId.slice(0, 8), sessionId);

  setTabs(produce((draft) => {
    draft.push({ id, type: 'chat', label: leaf.label, sessionId, root: leaf, focus: leaf.id });
  }));
  setActiveTabId(id);
  setAppActiveTab(sessionId);
  navigate('chat');
  return id;
}

export function openExplorerTab(): string {
  const existing = tabs.find(t => t.type === 'explorer');
  if (existing) {
    setActiveTabId(existing.id);
    navigate('explorer');
    return existing.id;
  }

  const id = '__explorer__';
  const leaf = createLeaf('explorer', 'Explorador');

  setTabs(produce((draft) => {
    draft.push({ id, type: 'explorer', label: 'Explorador', root: leaf, focus: leaf.id });
  }));
  setActiveTabId(id);
  navigate('explorer');
  return id;
}

export function activateTab(tabId: string): void {
  setActiveTabId(tabId);
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  const leaf = findLeaf(tab.root, tab.focus);
  if (leaf?.type === 'chat' && leaf.sessionId) {
    setAppActiveTab(leaf.sessionId);
    navigate('chat');
  } else if (leaf?.type === 'explorer') {
    navigate('explorer');
  }
}

export function closeTab(tabId: string): void {
  const idx = tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;
  const wasActive = activeTabId() === tabId;

  setTabs(produce((draft) => { draft.splice(idx, 1); }));

  if (wasActive) {
    if (tabs.length > 0) {
      const next = tabs[idx] ?? tabs[idx - 1] ?? null;
      if (next) { activateTab(next.id); return; }
    }
    setActiveTabId(null);
    const prev = appState.previousView.value;
    navigate(prev && prev !== 'chat' ? prev : 'welcome');
  }
}

export function nextTab(): void {
  const id = activeTabId();
  if (!id || tabs.length < 2) return;
  const idx = tabs.findIndex(t => t.id === id);
  const next = tabs[(idx + 1) % tabs.length];
  if (next) activateTab(next.id);
}

export function prevTab(): void {
  const id = activeTabId();
  if (!id || tabs.length < 2) return;
  const idx = tabs.findIndex(t => t.id === id);
  const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
  if (prev) activateTab(prev.id);
}

export function closeAllTabs(): void {
  setTabs(() => []);
  setActiveTabId(null);
}

// ═══════════════════════════════════════════════════════════
// Acciones — Tiles (split tree)
// ═══════════════════════════════════════════════════════════

export function splitTile(tabId: string, direction: SplitDir, tileType?: TabType): void {
  setTabs(produce((draft) => {
    const tab = draft.find(t => t.id === tabId);
    if (!tab) return;

    const newLeaf = createLeaf(
      tileType ?? 'explorer',
      tileType === 'chat' ? 'Nuevo chat' : 'Explorador',
    );
    tab.root = splitNode(tab.root, tab.focus, direction, newLeaf);
    tab.focus = newLeaf.id;
    syncFromFocus(tab);
  }));
}

export function closeTile(tabId: string, tileId: string): void {
  setTabs(produce((draft) => {
    const tab = draft.find(t => t.id === tabId);
    if (!tab || leafCount(tab.root) <= 1) return;

    const newRoot = removeNode(tab.root, tileId);
    if (!newRoot) return;

    tab.root = newRoot;
    if (tab.focus === tileId) {
      tab.focus = firstLeafId(newRoot);
    }
    syncFromFocus(tab);
  }));
}

export function closeActiveTile(): void {
  const tabId = activeTabId();
  if (!tabId) return;
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  if (leafCount(tab.root) <= 1) {
    closeTab(tabId);
    return;
  }
  closeTile(tabId, tab.focus);
}

export function setActiveTile(tabId: string, tileId: string): void {
  setTabs(produce((draft) => {
    const tab = draft.find(t => t.id === tabId);
    if (!tab || !findLeaf(tab.root, tileId)) return;
    tab.focus = tileId;
    syncFromFocus(tab);
  }));

  // Sincronizar appState
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  const leaf = findLeaf(tab.root, tileId);
  if (leaf?.type === 'chat' && leaf.sessionId) {
    setAppActiveTab(leaf.sessionId);
    navigate('chat');
  } else if (leaf?.type === 'explorer') {
    navigate('explorer');
  }
}

export function nextTile(): void {
  const tabId = activeTabId();
  if (!tabId) return;
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  const leaves = getAllLeaves(tab.root);
  if (leaves.length < 2) return;
  const idx = leaves.findIndex(l => l.id === tab.focus);
  const next = leaves[(idx + 1) % leaves.length];
  if (next) setActiveTile(tabId, next.id);
}

export function prevTile(): void {
  const tabId = activeTabId();
  if (!tabId) return;
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  const leaves = getAllLeaves(tab.root);
  if (leaves.length < 2) return;
  const idx = leaves.findIndex(l => l.id === tab.focus);
  const prev = leaves[(idx - 1 + leaves.length) % leaves.length];
  if (prev) setActiveTile(tabId, prev.id);
}

// ═══════════════════════════════════════════════════════════
// Sincronización con appState
// ═══════════════════════════════════════════════════════════

export function syncChatTab(sessionId: string, label: string): string {
  const existing = tabs.find(t => t.type === 'chat' && t.sessionId === sessionId);
  if (existing) {
    if (!activeTabId()) setActiveTabId(existing.id);
    return existing.id;
  }

  const id = uid();
  const leaf = createLeaf('chat', label, sessionId);

  setTabs(produce((draft) => {
    draft.push({ id, type: 'chat', label, sessionId, root: leaf, focus: leaf.id });
  }));
  if (!activeTabId()) setActiveTabId(id);
  return id;
}

export function resetTabState(): void {
  setTabs(() => []);
  setActiveTabId(null);
}
