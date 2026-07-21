/**
 * panel-manager.ts — Estado y acciones del sistema de paneles.
 *
 * Reemplaza tab-manager.ts con modelo de paneles planos (no árbol).
 * Cada tab tiene 1-4 paneles con tipos intercambiables (chat, explorer, etc.)
 * Progresión determinística: 1→2→3→4 con Ctrl+Shift+O, Ctrl+Shift+W revierte.
 *
 * Layout por cantidad de paneles:
 *   1 → [ A ]
 *   2 → [ A | B ]
 *   3 → [ A | B ]
 *        [   | C ]
 *   4 → [ A | B ]
 *        [ D | C ]
 */

import { createStore, produce } from 'solid-js/store';
import { createSignal } from 'solid-js';
import { appState, setActiveTab as setAppActiveTab } from 'xi-ui/lib/state.ts';
import { navigate } from 'xi-ui/lib/nav.ts';

// ═════════════════════════════════════════════
// Tipos
// ═════════════════════════════════════════════

export type PaneType = string; // 'chat' | 'explorer' | 'terminal' | ... extensible

export interface Pane {
  id: string;
  type: PaneType;
  label: string;
  sessionId?: string; // solo para type === 'chat'
}

export interface Tab {
  id: string;
  /** Sincronizado del panel con foco. Backward compat. */
  type: PaneType;
  /** Sincronizado del panel con foco. */
  label: string;
  /** Sincronizado del panel con foco. undefined si no es chat. */
  sessionId?: string;
  /** Paneles visibles (1-4). */
  panes: Pane[];
  /** ID del panel con foco. */
  focus: string;
}

// ═════════════════════════════════════════════
// Store
// ═════════════════════════════════════════════

const [tabs, setTabs] = createStore<Tab[]>([]);
const [activeTabId, setActiveTabId] = createSignal<string | null>(null);

// ═════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════

let counter = 0;
function uid(): string {
  return `tab-${++counter}-${Date.now().toString(36)}`;
}
function paneUid(): string {
  return `pane-${++counter}-${Date.now().toString(36)}`;
}

/** Sincroniza campos de nivel tab (type, label, sessionId) desde el panel con foco.
 *  Llámese dentro de un bloque produce(). */
function syncFromFocus(draft: Tab): void {
  const pane = draft.panes.find(p => p.id === draft.focus);
  if (!pane) return;
  draft.type = pane.type;
  draft.label = pane.label;
  draft.sessionId = pane.sessionId;
}

// ═════════════════════════════════════════════
// Getters
// ═════════════════════════════════════════════

export function getTabs(): Tab[] { return tabs; }
export function getActiveTabId(): string | null { return activeTabId(); }

export function getActiveTab(): Tab | null {
  const id = activeTabId();
  if (!id) return null;
  return tabs.find(t => t.id === id) ?? null;
}

export function getActivePane(): Pane | null {
  const tab = getActiveTab();
  if (!tab) return null;
  return tab.panes.find(p => p.id === tab.focus) ?? null;
}

// ═════════════════════════════════════════════
// Acciones — Tabs
// ═════════════════════════════════════════════

export function openChatTab(sessionId: string, label?: string): string {
  // openTabs: state-sync filtra eventos por esta lista
  if (!appState.openTabs.value.some((t) => t.id === sessionId)) {
    appState.openTabs.value = [...appState.openTabs.value, {
      id: sessionId, file: sessionId, name: label ?? sessionId, messageCount: 0,
    }];
  }
  const existing = tabs.find(t => t.type === 'chat' && t.sessionId === sessionId);
  if (existing) {
    setActiveTabId(existing.id);
    setAppActiveTab(sessionId);
    navigate('chat');
    return existing.id;
  }
  const id = uid();
  const paneId = paneUid();
  const paneLabel = label ?? sessionId.slice(0, 8);
  const pane: Pane = { id: paneId, type: 'chat', label: paneLabel, sessionId };
  setTabs(produce((draft) => {
    draft.push({ id, type: 'chat', label: paneLabel, sessionId, panes: [pane], focus: paneId });
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
  const paneId = 'pane-explorer';
  const pane: Pane = { id: paneId, type: 'explorer', label: 'Explorador' };
  setTabs(produce((draft) => {
    draft.push({ id, type: 'explorer', label: 'Explorador', panes: [pane], focus: paneId });
  }));
  setActiveTabId(id);
  navigate('explorer');
  return id;
}

/** Abre una tab nueva con un panel SessionsPicker. */
export function openSessionTab(): string {
  const id = uid();
  const paneId = paneUid();
  const pane: Pane = { id: paneId, type: 'sessions', label: 'Historial' };
  setTabs(produce((draft) => {
    draft.push({ id, type: 'sessions', label: 'Historial', panes: [pane], focus: paneId });
  }));
  setActiveTabId(id);
  navigate('sessions');
  return id;
}

export function activateTab(tabId: string): void {
  setActiveTabId(tabId);
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  const pane = tab.panes.find(p => p.id === tab.focus);
  if (pane?.type === 'chat' && pane.sessionId) {
    setAppActiveTab(pane.sessionId);
    navigate('chat');
  } else if (pane?.type === 'explorer') {
    navigate('explorer');
  } else if (pane?.type === 'sessions') {
    navigate('sessions');
  }
}

export function closeTab(tabId: string): void {
  const idx = tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;
  const wasActive = activeTabId() === tabId;
  const tab = tabs.find(t => t.id === tabId);
  const isLastTab = tabs.length === 1;

  setTabs(produce((draft) => { draft.splice(idx, 1); }));

  // Limpiar openTabs de las sesiones de esta tab
  const tabSessions = tab?.panes.filter(p => p.sessionId).map(p => p.sessionId!) ?? [];
  if (tabSessions.length > 0) {
    appState.openTabs.value = appState.openTabs.value.filter(
      (t) => !tabSessions.includes(t.id)
    );
  }

  // Si era la ultima tab, auto-crear SessionsPicker
  if (isLastTab) {
    openSessionTab();
    return;
  }

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

// ═════════════════════════════════════════════
// Acciones — Paneles
// ═════════════════════════════════════════════

/** Agrega un panel a la tab según progresión determinística. Máx 4. */
export function addPane(tabId: string, paneType?: PaneType): void {
  setTabs(produce((draft) => {
    const tab = draft.find(t => t.id === tabId);
    if (!tab || tab.panes.length >= 4) return;
    const newPane: Pane = {
      id: paneUid(),
      type: paneType ?? 'sessions',
      label: paneType === 'chat' ? 'Nuevo chat' : 'Nueva sesión',
    };
    tab.panes.push(newPane);
    tab.focus = newPane.id;
    syncFromFocus(tab);
  }));
}

/** Cambia el tipo de un panel existente (sessions → chat, sessions → explorer, etc.). */
export function setPaneType(tabId: string, paneId: string, type: PaneType, sessionId?: string): void {
  setTabs(produce((draft) => {
    const tab = draft.find(t => t.id === tabId);
    if (!tab) return;
    const pane = tab.panes.find(p => p.id === paneId);
    if (!pane) return;
    pane.type = type;
    if (type === 'chat' && sessionId) {
      pane.sessionId = sessionId;
      pane.label = sessionId.split('/').pop() || 'Chat';
      tab.type = 'chat';
      tab.label = pane.label;
      tab.sessionId = sessionId;
    } else if (type === 'explorer') {
      pane.sessionId = undefined;
      pane.label = 'Explorador';
      tab.type = 'explorer';
      tab.label = 'Explorador';
    } else if (type === 'sessions') {
      pane.sessionId = undefined;
      pane.label = 'Historial';
      tab.type = 'sessions';
      tab.label = 'Historial';
    }
  }));
  // Sincronizar estado global + openTabs para state-sync
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  const pane = tab.panes.find(p => p.id === paneId);
  // Actualizar openTabs: state-sync filtra eventos por esta lista
  if (sessionId && !appState.openTabs.value.some((t) => t.id === sessionId)) {
    appState.openTabs.value = [...appState.openTabs.value, {
      id: sessionId,
      file: sessionId,
      name: pane?.label ?? sessionId,
      messageCount: 0,
    }];
  }
  if (pane?.type === 'chat' && pane.sessionId) {
    setAppActiveTab(pane.sessionId);
    navigate('chat');
  } else if (pane?.type === 'explorer') {
    navigate('explorer');
  } else if (pane?.type === 'sessions') {
    navigate('sessions');
  }
}

/** Elimina el ultimo panel de la tab. Min 1. */
export function removeLastPane(tabId: string): void {
  setTabs(produce((draft) => {
    const tab = draft.find(t => t.id === tabId);
    if (!tab || tab.panes.length <= 1) return;
    tab.panes.pop();
    if (tab.panes.every(p => p.id !== tab.focus)) {
      tab.focus = tab.panes[tab.panes.length - 1].id;
      syncFromFocus(tab);
    }
  }));
  // Sincronizar estado global después del pop
  const tab = tabs.find(t => t.id === tabId);
  if (tab) {
    const pane = tab.panes.find(p => p.id === tab.focus);
    if (pane?.type === 'chat' && pane.sessionId) {
      navigate('chat');
    }
  }
}

/** Activa un panel específico dentro de una tab. */
export function setFocus(tabId: string, paneId: string): void {
  setTabs(produce((draft) => {
    const tab = draft.find(t => t.id === tabId);
    if (!tab || !tab.panes.find(p => p.id === paneId)) return;
    tab.focus = paneId;
    syncFromFocus(tab);
  }));
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  const pane = tab.panes.find(p => p.id === paneId);
  if (pane?.type === 'chat' && pane.sessionId) {
    setAppActiveTab(pane.sessionId);
    navigate('chat');
  } else if (pane?.type === 'explorer') {
    navigate('explorer');
  }
}

export function nextPane(): void {
  const tabId = activeTabId();
  if (!tabId) return;
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || tab.panes.length < 2) return;
  const idx = tab.panes.findIndex(p => p.id === tab.focus);
  const next = tab.panes[(idx + 1) % tab.panes.length];
  if (next) setFocus(tabId, next.id);
}

export function prevPane(): void {
  const tabId = activeTabId();
  if (!tabId) return;
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || tab.panes.length < 2) return;
  const idx = tab.panes.findIndex(p => p.id === tab.focus);
  const prev = tab.panes[(idx - 1 + tab.panes.length) % tab.panes.length];
  if (prev) setFocus(tabId, prev.id);
}

export function tabHasMultiplePanes(): boolean {
  const tab = getActiveTab();
  return !!tab && tab.panes.length > 1;
}

// ═════════════════════════════════════════════
// Sincronización con appState
// ═════════════════════════════════════════════

export function syncChatTab(sessionId: string, label: string): string {
  const existing = tabs.find(t => t.type === 'chat' && t.sessionId === sessionId);
  if (existing) {
    if (!activeTabId()) setActiveTabId(existing.id);
    return existing.id;
  }
  const id = uid();
  const paneId = paneUid();
  const pane: Pane = { id: paneId, type: 'chat', label, sessionId };
  setTabs(produce((draft) => {
    draft.push({ id, type: 'chat', label, sessionId, panes: [pane], focus: paneId });
  }));
  if (!activeTabId()) setActiveTabId(id);
  return id;
}

export function resetTabState(): void {
  setTabs(() => []);
  setActiveTabId(null);
}
