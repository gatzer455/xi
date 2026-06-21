/**
 * state.test.ts — Tests para el estado global (Capa 4: State)
 *
 * Testea: appState signals, setActiveTab, getActiveTab,
 * persistencia de mensajes por tab.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { appState, setActiveTab, getActiveTab, type Session } from '../src/lib/state.ts';

describe('appState', () => {
  beforeEach(() => {
    // Resetear signals a valores iniciales antes de cada test
    appState.workingDir.value = null;
    appState.session.value = null;
    appState.messages.value = [];
    appState.isStreaming.value = false;
    appState.currentModel.value = null;
    appState.thinkingLevel.value = 'medium';
    appState.currentView.value = 'welcome';
    appState.previousView.value = 'welcome';
    appState.openTabs.value = [];
    appState.activeTabId.value = null;
    appState.tabMessages.value = {};
    appState.files.value = [];
    appState.explorerPath.value = '';
    appState.selectedFile.value = null;
    appState.fileContent.value = null;
    appState.isEditing.value = false;
  });

  // ─── Signals básicas ──────────────────────────────────────
  it('workingDir inicia en null', () => {
    expect(appState.workingDir.value).toBeNull();
  });

  it('messages inicia vacío', () => {
    expect(appState.messages.value).toEqual([]);
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

  // ─── setActiveTab ─────────────────────────────────────────
  describe('setActiveTab', () => {
    const tab1: Session = { id: 'tab-1', name: 'Tab 1', messageCount: 0 };
    const tab2: Session = { id: 'tab-2', name: 'Tab 2', messageCount: 0 };

    it('setea activeTabId', () => {
      setActiveTab('tab-1');
      expect(appState.activeTabId.value).toBe('tab-1');
    });

    it('setea null para desactivar', () => {
      setActiveTab('tab-1');
      setActiveTab(null);
      expect(appState.activeTabId.value).toBeNull();
    });

    it('NO hace nada si el tabId es el mismo', () => {
      setActiveTab('tab-1');
      const fn = vi.fn();
      appState.activeTabId.subscribe(fn);

      setActiveTab('tab-1'); // mismo id
      expect(fn).toHaveBeenCalledTimes(1); // solo el subscribe inicial
    });

    it('carga mensajes de la tab al cambiar', () => {
      const msgs = [
        { id: '1', role: 'user' as const, content: 'Hola', timestamp: Date.now() },
      ];
      appState.tabMessages.value = { 'tab-1': msgs };

      setActiveTab('tab-1');
      expect(appState.messages.value).toEqual(msgs);
    });

    it('limpia mensajes al setear null (desde una tab)', () => {
      // Primero activar una tab
      setActiveTab('tab-1');
      appState.messages.value = [
        { id: '1', role: 'user' as const, content: 'Hola', timestamp: Date.now() },
      ];

      // Cambiar a null - debería limpiar
      setActiveTab(null);
      expect(appState.messages.value).toEqual([]);
    });

    it('guarda mensajes de la tab vieja antes de cambiar', () => {
      // Tab 1 tiene mensajes
      appState.tabMessages.value = {};
      setActiveTab('tab-1');
      appState.messages.value = [
        { id: '1', role: 'user' as const, content: 'Msg 1', timestamp: Date.now() },
      ];

      // Cambiar a tab 2
      setActiveTab('tab-2');

      // Tab 1 debería tener sus mensajes guardados
      expect(appState.tabMessages.value['tab-1']).toEqual([
        { id: '1', role: 'user' as const, content: 'Msg 1', timestamp: Date.now() },
      ]);
    });

    it('carga mensajes vacíos si la tab no tiene mensajes guardados', () => {
      setActiveTab('tab-1');
      expect(appState.messages.value).toEqual([]);
    });

    it('mantiene mensajes de tab 1 al volver', () => {
      const msgs1 = [
        { id: '1', role: 'user' as const, content: 'Msg 1', timestamp: Date.now() },
      ];
      const msgs2 = [
        { id: '2', role: 'user' as const, content: 'Msg 2', timestamp: Date.now() },
      ];

      setActiveTab('tab-1');
      appState.messages.value = msgs1;

      setActiveTab('tab-2');
      appState.messages.value = msgs2;

      // Volver a tab 1
      setActiveTab('tab-1');
      expect(appState.messages.value).toEqual(msgs1);
    });
  });

  // ─── getActiveTab ─────────────────────────────────────────
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

  // ─── Explorer state ───────────────────────────────────────
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

  // ─── Tabs persistence ─────────────────────────────────────
  describe('tabs persistence', () => {
    it('tabMessages guarda mensajes de la tab vieja al cambiar', () => {
      const msgs1 = [
        { id: '1', role: 'user' as const, content: 'Msg 1', timestamp: Date.now() },
      ];
      const msgs2 = [
        { id: '2', role: 'assistant' as const, content: 'Msg 2', timestamp: Date.now() },
      ];

      setActiveTab('tab-1');
      appState.messages.value = msgs1;

      setActiveTab('tab-2');
      appState.messages.value = msgs2;

      // Solo tab-1 tiene mensajes guardados (se guardó al cambiar)
      expect(appState.tabMessages.value['tab-1']).toEqual(msgs1);
      // tab-2 no tiene mensajes guardados aún (no se ha cambiado desde tab-2)
      expect(appState.tabMessages.value['tab-2']).toBeUndefined();
    });

    it('tabMessages guarda mensajes de ambas tabs al cambiar entre ellas', () => {
      const msgs1 = [
        { id: '1', role: 'user' as const, content: 'Msg 1', timestamp: Date.now() },
      ];
      const msgs2 = [
        { id: '2', role: 'assistant' as const, content: 'Msg 2', timestamp: Date.now() },
      ];

      setActiveTab('tab-1');
      appState.messages.value = msgs1;

      setActiveTab('tab-2');
      appState.messages.value = msgs2;

      // Cambiar de vuelta a tab-1 para guardar mensajes de tab-2
      setActiveTab('tab-1');

      // Ahora ambas tabs tienen mensajes guardados
      expect(appState.tabMessages.value['tab-1']).toEqual(msgs1);
      expect(appState.tabMessages.value['tab-2']).toEqual(msgs2);
    });

    it('openTabs mantiene el orden', () => {
      const tabs: Session[] = [
        { id: 'tab-1', name: 'Tab 1', messageCount: 0 },
        { id: 'tab-2', name: 'Tab 2', messageCount: 0 },
        { id: 'tab-3', name: 'Tab 3', messageCount: 0 },
      ];

      appState.openTabs.value = tabs;
      expect(appState.openTabs.value).toHaveLength(3);
      expect(appState.openTabs.value[0].id).toBe('tab-1');
    });
  });
});
