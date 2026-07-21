import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('xi-ui/lib/state.ts', () => ({
  appState: {
    activeTabId: { value: null },
    previousView: { value: 'welcome' },
    isStreaming: { value: false },
    currentView: { value: 'welcome' },
    openTabs: { value: [], subscribe: vi.fn(() => vi.fn()) },
  },
  setActiveTab: vi.fn(),
}));

vi.mock('xi-ui/lib/nav.ts', () => ({
  navigate: vi.fn(),
}));

vi.mock('xi-ui/lib/chat/stores.ts', () => ({
  dropStore: vi.fn(),
}));

vi.mock('../lib/pi/index.ts', () => ({
  abortPi: vi.fn(() => Promise.resolve()),
}));

import {
  resetTabState,
  openChatTab,
  openExplorerTab,
  getTabs,
  getActiveTabId,
  getActiveTab,
  getActivePane,
  addPane,
  removeLastPane,
  setFocus,
  nextPane,
  prevPane,
  tabHasMultiplePanes,
  closeTab,
} from '../src/lib/panel-manager.ts';

beforeEach(() => {
  resetTabState();
});

describe('panel manager', () => {
  it('creates tab with 1 pane via openChatTab', () => {
    const id = openChatTab('session-1', 'Chat 1');
    const tab = getActiveTab();
    expect(tab).not.toBeNull();
    expect(tab!.panes.length).toBe(1);
    expect(tab!.panes[0].type).toBe('chat');
    expect(tab!.panes[0].sessionId).toBe('session-1');
    expect(tab!.focus).toBe(tab!.panes[0].id);
  });

  it('addPane adds a pane (1→2)', () => {
    const id = openChatTab('session-1', 'Chat 1');
    addPane(id, 'explorer');
    const tab = getActiveTab()!;
    expect(tab.panes.length).toBe(2);
    expect(tab.panes[1].type).toBe('explorer');
    // Focus moves to new pane
    expect(tab.focus).toBe(tab.panes[1].id);
  });

  it('addPane max 4 panes', () => {
    const id = openChatTab('session-1', 'Chat 1');
    addPane(id, 'explorer');
    addPane(id, 'chat');
    addPane(id, 'explorer');
    addPane(id, 'explorer'); // 5th ignored
    const tab = getActiveTab()!;
    expect(tab.panes.length).toBe(4);
  });

  it('removeLastPane goes 3→2', () => {
    const id = openChatTab('session-1', 'Chat 1');
    addPane(id, 'explorer');
    addPane(id, 'chat');
    expect(getActiveTab()!.panes.length).toBe(3);
    removeLastPane(id);
    expect(getActiveTab()!.panes.length).toBe(2);
  });

  it('removeLastPane does nothing on 1 pane', () => {
    const id = openChatTab('session-1', 'Chat 1');
    removeLastPane(id);
    expect(getActiveTab()!.panes.length).toBe(1);
  });

  it('setFocus switches active pane', () => {
    const id = openChatTab('session-1', 'Chat 1');
    addPane(id, 'explorer');
    const tab = getActiveTab()!;
    const firstPane = tab.panes[0];
    setFocus(id, firstPane.id);
    expect(tab.focus).toBe(firstPane.id);
    expect(tab.type).toBe('chat');
  });

  it('nextPane cycles through panes', () => {
    const id = openChatTab('session-1', 'Chat 1');
    addPane(id, 'explorer');
    addPane(id, 'chat');
    const tab = getActiveTab()!;
    const initialIdx = tab.panes.findIndex(p => p.id === tab.focus);
    nextPane();
    const afterIdx = tab.panes.findIndex(p => p.id === tab.focus);
    expect((initialIdx + 1) % tab.panes.length).toBe(afterIdx);
  });

  it('prevPane cycles backwards', () => {
    const id = openChatTab('session-1', 'Chat 1');
    addPane(id, 'explorer');
    const tab = getActiveTab()!;
    const initialIdx = tab.panes.findIndex(p => p.id === tab.focus);
    prevPane();
    const afterIdx = tab.panes.findIndex(p => p.id === tab.focus);
    expect((initialIdx - 1 + tab.panes.length) % tab.panes.length).toBe(afterIdx);
  });

  it('tabHasMultiplePanes', () => {
    const id = openChatTab('session-1', 'Chat 1');
    expect(tabHasMultiplePanes()).toBe(false);
    addPane(id, 'explorer');
    expect(tabHasMultiplePanes()).toBe(true);
  });

  it('closeTab removes tab and activates next', () => {
    const id1 = openChatTab('session-1', 'Chat 1');
    const id2 = openChatTab('session-2', 'Chat 2');
    expect(getTabs().length).toBe(2);
    
    // Close the active tab (id2, since it was activated last)
    closeTab(id2);
    expect(getTabs().length).toBe(1);
    // Active tab should fall back to the other
    expect(getActiveTab()?.id).toBe(id1);
  });
});
