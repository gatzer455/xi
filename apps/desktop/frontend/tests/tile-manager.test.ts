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
  resetTabState, openChatTab, openExplorerTab,
  getTabs, getActiveTabId, getActiveTab, getActiveTile,
  splitTile, closeTile, setActiveTile, nextTile, prevTile,
  closeActiveTile,
} from '../src/lib/tab-manager.ts';

beforeEach(() => {
  resetTabState();
});

describe('tile manager', () => {
  it('creates tab with single tile via openChatTab', () => {
    const id = openChatTab('session-1', 'Chat 1');
    const tab = getActiveTab();
    expect(tab).not.toBeNull();
    expect(tab!.tiles.length).toBe(1);
    expect(tab!.tiles[0].type).toBe('chat');
    expect(tab!.tiles[0].sessionId).toBe('session-1');
    expect(tab!.layout.direction).toBeNull();
  });

  it('splitTile adds a tile and updates layout', () => {
    const id = openChatTab('session-1', 'Chat 1');
    splitTile(id, 'horizontal');
    
    const tab = getActiveTab();
    expect(tab!.tiles.length).toBe(2);
    expect(tab!.layout.direction).toBe('horizontal');
    expect(tab!.layout.sizes).toEqual([0.5, 0.5]);
    expect(tab!.type).toBe('explorer'); // active tile becomes explorer
  });

  it('closeTile removes a tile', () => {
    const id = openChatTab('session-1', 'Chat 1');
    splitTile(id, 'horizontal');
    const tab = getActiveTab()!;
    const tileId = tab.tiles[0].id;
    closeTile(id, tileId);
    expect(tab.tiles.length).toBe(1);
  });

  it('closeTile does nothing on last tile', () => {
    const id = openChatTab('session-1', 'Chat 1');
    const tab = getActiveTab()!;
    closeTile(id, tab.tiles[0].id);
    expect(tab.tiles.length).toBe(1);
  });

  it('setActiveTile toggles between tiles', () => {
    const id = openChatTab('session-1', 'Chat 1');
    splitTile(id, 'horizontal');
    const tab = getActiveTab()!;
    const firstTileId = tab.tiles[0].id;
    setActiveTile(id, firstTileId);
    expect(tab.activeTileId).toBe(firstTileId);
    expect(tab.type).toBe('chat');
  });

  it('nextTile cycles through tiles', () => {
    const id = openChatTab('session-1', 'Chat 1');
    splitTile(id, 'horizontal');
    splitTile(id, 'vertical');
    
    const tab = getActiveTab()!;
    const initialIdx = tab.tiles.findIndex(t => t.id === tab.activeTileId);
    nextTile();
    const afterIdx = tab.tiles.findIndex(t => t.id === tab.activeTileId);
    expect((initialIdx + 1) % tab.tiles.length).toBe(afterIdx);
  });
});
