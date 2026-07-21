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
  closeActiveTile, findLeaf, getAllLeaves, leafCount, tabHasMultipleLeaves,
} from '../src/lib/tab-manager.ts';

beforeEach(() => {
  resetTabState();
});

describe('tile manager (tree)', () => {
  it('creates tab with single leaf via openChatTab', () => {
    const id = openChatTab('session-1', 'Chat 1');
    const tab = getActiveTab();
    expect(tab).not.toBeNull();
    expect(leafCount(tab!.root)).toBe(1);
    expect(tab!.root.kind).toBe('leaf');
    if (tab!.root.kind === 'leaf') {
      expect(tab!.root.type).toBe('chat');
      expect(tab!.root.sessionId).toBe('session-1');
    }
  });

  it('splitTile wraps leaf in a split node', () => {
    const id = openChatTab('session-1', 'Chat 1');
    splitTile(id, 'horizontal');

    const tab = getActiveTab();
    expect(leafCount(tab!.root)).toBe(2);
    expect(tab!.root.kind).toBe('split');
    if (tab!.root.kind === 'split') {
      expect(tab!.root.direction).toBe('horizontal');
    }
    // Focus is on the new leaf (explorer)
    expect(tab!.type).toBe('explorer');
    expect(tab!.focus).not.toBe('');
  });

  it('closeTile removes a leaf and collapses split', () => {
    const id = openChatTab('session-1', 'Chat 1');
    splitTile(id, 'horizontal');

    const tab = getActiveTab()!;
    const leaves = getAllLeaves(tab.root);
    const firstLeafId = leaves[0].id;
    closeTile(id, firstLeafId);

    expect(leafCount(tab.root)).toBe(1);
    expect(tab.root.kind).toBe('leaf'); // collapsed back
  });

  it('closeTile does nothing on last leaf', () => {
    const id = openChatTab('session-1', 'Chat 1');
    const tab = getActiveTab()!;
    // root is a leaf, focus is that leaf
    const leafId = tab.focus;
    closeTile(id, leafId);
    // still one leaf
    expect(leafCount(tab.root)).toBe(1);
  });

  it('setActiveTile toggles focus between leaves', () => {
    const id = openChatTab('session-1', 'Chat 1');
    splitTile(id, 'horizontal');

    const tab = getActiveTab()!;
    const leaves = getAllLeaves(tab.root);
    const chatLeaf = leaves.find(l => l.type === 'chat')!;
    setActiveTile(id, chatLeaf.id);

    expect(tab.focus).toBe(chatLeaf.id);
    expect(tab.type).toBe('chat');
  });

  it('nextTile cycles through leaves', () => {
    const id = openChatTab('session-1', 'Chat 1');
    splitTile(id, 'horizontal');
    splitTile(id, 'vertical');

    const tab = getActiveTab()!;
    const leaves = getAllLeaves(tab.root);
    const currentIdx = leaves.findIndex(l => l.id === tab.focus);
    nextTile();
    const afterIdx = leaves.findIndex(l => l.id === tab.focus);
    expect((currentIdx + 1) % leaves.length).toBe(afterIdx);
  });

  it('tabHasMultipleLeaves detects splits', () => {
    const id = openChatTab('session-1', 'Chat 1');
    expect(tabHasMultipleLeaves(id)).toBe(false);
    splitTile(id, 'horizontal');
    expect(tabHasMultipleLeaves(id)).toBe(true);
  });

  it('nested splits work (right then down)', () => {
    const id = openChatTab('session-1', 'Chat 1');
    splitTile(id, 'horizontal'); // chat | explorer
    // Focus is on explorer now. Split explorer vertically
    splitTile(id, 'vertical');   // chat | (explorer / new explorer)

    const tab = getActiveTab()!;
    expect(leafCount(tab.root)).toBe(3);
    // Root should be horizontal split
    expect(tab.root.kind).toBe('split');
    if (tab.root.kind === 'split') {
      expect(tab.root.direction).toBe('horizontal');
      // Right child should be a vertical split
      expect(tab.root.right.kind).toBe('split');
      if (tab.root.right.kind === 'split') {
        expect(tab.root.right.direction).toBe('vertical');
      }
    }
  });

  it('closeActiveTile on multi-leaf closes leaf not tab', () => {
    const id = openChatTab('session-1', 'Chat 1');
    splitTile(id, 'horizontal');
    const tab = getActiveTab()!;
    expect(leafCount(tab.root)).toBe(2);
    closeActiveTile();
    expect(leafCount(tab.root)).toBe(1);
    expect(getActiveTab()).not.toBeNull(); // tab still exists
  });
});
