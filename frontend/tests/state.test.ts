/**
 * state.test.ts — Tests para el estado global (Capa 4: State).
 *
 * chat-architecture-v2: los MENSAJES viven en ChatStores per-tab
 * (lib/chat/stores.ts), no en appState. Acá testeamos solo las
 * signals globales + setActiveTab/getActiveTab (sin shuffle de
 * messages, que ya no existe).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { appState, setActiveTab, getActiveTab, type Session } from '../src/lib/state.ts';

describe('appState', () => {
  beforeEach(() => {
    appState.workingDir.value = null;
    appState.session.value = null;
    appState.isStreaming.value = false;
    appState.currentModel.value = null;
    appState.thinkingLevel.value = 'medium';
    appState.currentView.value = 'welcome';
    appState.previousView.value = 'welcome';
    appState.openTabs.value = [];
    appState.activeTabId.value = null;
    appState.files.value = [];
    appState.explorerPath.value = '';
    appState.selectedFile.value = null;
    appState.fileContent.value = null;
    appState.isEditing.value = false;
  });

  // ─── Signals básicas ────────────────────────────────────
  it('workingDir inicia en null', () => {
    expect(appState.workingDir.value).toBeNull();
  });

  it('isStreaming inicia en false', () => {
    expect(appState.isStreaming.value).toBe(false);
  });

  it('thinkingLevel inicia en medium', () => {
    expect(appState.thinkingLevel.value).toBe('medium');
  });

  it('currentView inicia en welcome', () => {
    expect(appState.currentView.value).toBe('welcome');
  });

  it('session inicia en null', () => {
    expect(appState.session.value).toBeNull();
  });

  // ─── setActiveTab ────────────────────────────────────────
  describe('setActiveTab', () => {
    it('setea activeTabId', () => {
      setActiveTab('tab-1');
      expect(appState.activeTabId.value).toBe('tab-1');
    });

    it('setea null para desactivar', () => {
      setActiveTab('tab-1');
      setActiveTab(null);
      expect(appState.activeTabId.value).toBeNull();
    });

    it('NO dispar el subscriber si el tabId es el mismo', () => {
      setActiveTab('tab-1');
      const fn = vi.fn();
      appState.activeTabId.subscribe(fn);
      fn.mockClear();

      setActiveTab('tab-1'); // mismo id
      expect(fn).not.toHaveBeenCalled();
    });

    it('dispara el subscriber al cambiar', () => {
      setActiveTab('tab-1');
      const fn = vi.fn();
      appState.activeTabId.subscribe(fn);
      fn.mockClear();

      setActiveTab('tab-2');
      expect(fn).toHaveBeenCalledWith('tab-2');
    });

    it('NO toca session (metadatos de pi se manejan aparte)', () => {
      appState.session.value = { id: 's1', name: 'x', file: '/p', messageCount: 5 };
      setActiveTab('tab-1');
      expect(appState.session.value).not.toBeNull();
    });
  });

  // ─── getActiveTab ────────────────────────────────────────
  describe('getActiveTab', () => {
    const tab1: Session = { id: 'tab-1', name: 'Tab 1', messageCount: 0 };

    it('retorna null si no hay tab activa', () => {
      expect(getActiveTab()).toBeNull();
    });

    it('retorna la tab activa', () => {
      appState.openTabs.value = [tab1];
      appState.activeTabId.value = 'tab-1';
      expect(getActiveTab()).toEqual(tab1);
    });

    it('retorna null si la tab no existe en openTabs', () => {
      appState.openTabs.value = [];
      appState.activeTabId.value = 'tab-1';
      expect(getActiveTab()).toBeNull();
    });
  });

  // ─── Explorer state ──────────────────────────────────────
  describe('explorer state', () => {
    it('files inicia vacío', () => {
      expect(appState.files.value).toEqual([]);
    });
    it('selectedFile inicia en null', () => {
      expect(appState.selectedFile.value).toBeNull();
    });
    it('isEditing inicia en false', () => {
      expect(appState.isEditing.value).toBe(false);
    });
    it('fileContent inicia en null', () => {
      expect(appState.fileContent.value).toBeNull();
    });
  });

  // ─── Tabs ────────────────────────────────────────────────
  describe('openTabs', () => {
    it('mantiene el orden', () => {
      const tabs: Session[] = [
        { id: 'tab-1', name: 'T1', messageCount: 0 },
        { id: 'tab-2', name: 'T2', messageCount: 0 },
        { id: 'tab-3', name: 'T3', messageCount: 0 },
      ];
      appState.openTabs.value = tabs;
      expect(appState.openTabs.value).toHaveLength(3);
      expect(appState.openTabs.value[0].id).toBe('tab-1');
    });
  });
});