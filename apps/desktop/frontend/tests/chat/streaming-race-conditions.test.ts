/**
 * streaming-race-conditions.test.ts — Pruebas de regresión para condiciones
 * de carrera y eventos desordenados/tardíos en el streaming de pi.
 *
 * Valida específicamente que eventos como `message_update` o `agent_settled`
 * que llegan DESPUÉS de `agent_end` no re-activen la señal `isStreaming$` ni
 * dejen la interfaz en estado congelado ("Trabajando...").
 *
 * @vitest-environment jsdom
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  ev,
  assistantPartial,
  assistantFinal,
} from './fixtures/pi-events.ts';

const mockState = vi.hoisted(() => {
  function mockSignal<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      get value() { return value; },
      set value(v: T) {
        if (v === value) return;
        value = v;
        subs.forEach((fn) => fn(value));
      },
      subscribe(fn: (v: T) => void) {
        subs.add(fn);
        fn(value);
        return () => { subs.delete(fn); };
      },
    };
  }

  const openTabs = mockSignal<Array<{ id: string; file?: string; name: string; messageCount: number }>>([]);
  const activeTabId = mockSignal<string | null>(null);
  const isStreaming = mockSignal<boolean>(false);
  const currentModel = mockSignal<unknown>(null);
  const thinkingLevel = mockSignal<string>('off');
  const session = mockSignal<unknown>(null);
  const availableModels = mockSignal<unknown[]>([]);
  const activeExtensionDialog = mockSignal<unknown>(null);
  const workingDir = mockSignal<string | null>('/workspace');
  const explorerPanelOpen = mockSignal<boolean>(false);
  const hasAnyProvider = mockSignal<boolean>(true);

  return {
    openTabs,
    activeTabId,
    isStreaming,
    currentModel,
    thinkingLevel,
    session,
    availableModels,
    activeExtensionDialog,
    workingDir,
    explorerPanelOpen,
    hasAnyProvider,
  };
});

vi.mock('xi-ui/lib/state.ts', () => ({
  appState: {
    openTabs: mockState.openTabs,
    activeTabId: mockState.activeTabId,
    isStreaming: mockState.isStreaming,
    currentModel: mockState.currentModel,
    thinkingLevel: mockState.thinkingLevel,
    session: mockState.session,
    availableModels: mockState.availableModels,
    activeExtensionDialog: mockState.activeExtensionDialog,
    workingDir: mockState.workingDir,
    explorerPanelOpen: mockState.explorerPanelOpen,
    hasAnyProvider: mockState.hasAnyProvider,
  },
  setActiveTab(tabId: string | null) {
    mockState.activeTabId.value = tabId;
  },
  toTabId: (x: string) => x as any,
  toSessionPath: (x: string) => x as any,
}));

vi.mock('xi-ui/lib/debug-panel.ts', () => ({
  addEntry: () => {},
}));

vi.mock('xi-ui/lib/pi/slash-commands.ts', () => ({
  setKnownExtensionCommands: () => {},
}));

import { clearStores, getStore } from 'xi-ui/lib/chat/stores.ts';
import { applyEvent, beginStreamForSession, endStream } from 'xi-ui/lib/pi/state-sync.ts';

function setOpenTabs(tabIds: string[]): void {
  mockState.openTabs.value = tabIds.map((id) => ({
    id,
    file: id,
    name: id,
    messageCount: 0,
  }));
}

describe('Streaming Race Conditions & Late Events Guard', () => {
  beforeEach(() => {
    clearStores();
    endStream();
    mockState.activeTabId.value = null;
    mockState.openTabs.value = [];
  });

  test('message_update tardío posterior a agent_end NO debe re-activar isStreaming$', () => {
    const sessionPath = '/home/user/.pi/sessions/test-session.jsonl';
    mockState.activeTabId.value = sessionPath;
    setOpenTabs([sessionPath]);

    const store = getStore(sessionPath);
    expect(store.isStreaming$.value).toBe(false);

    // 1. Iniciar streaming
    beginStreamForSession(sessionPath);
    applyEvent(ev.agent_start());
    expect(mockState.isStreaming.value).toBe(true);
    expect(store.isStreaming$.value).toBe(true);

    // 2. Stream de mensajes del asistente
    applyEvent(ev.message_start(assistantPartial('Hola', 1000)));
    applyEvent(ev.message_update(assistantPartial('Hola mundo', 1050), ' mundo'));
    applyEvent(ev.message_end(assistantFinal('Hola mundo', 1100)));

    // 3. Finalizar agente
    applyEvent(ev.agent_end([assistantFinal('Hola mundo', 1100)]));
    expect(mockState.isStreaming.value).toBe(false);
    expect(store.isStreaming$.value).toBe(false);

    // 4. EVENTO TARDÍO: Pi envía agent_settled + message_update con stats de usage finales
    applyEvent({ type: 'agent_settled' } as any);
    applyEvent(ev.message_update(assistantFinal('Hola mundo', 1100), ''));

    // VERIFICACIÓN CRÍTICA: isStreaming NO debe haber cambiado a true
    expect(mockState.isStreaming.value).toBe(false);
    expect(store.isStreaming$.value).toBe(false);
  });

  test('Turnos consecutivos responden correctamente al reinicio de streamSettled', () => {
    const sessionPath = '/home/user/.pi/sessions/multi-turn.jsonl';
    mockState.activeTabId.value = sessionPath;
    setOpenTabs([sessionPath]);

    const store = getStore(sessionPath);

    // Turno 1
    beginStreamForSession(sessionPath);
    applyEvent(ev.agent_start());
    expect(store.isStreaming$.value).toBe(true);

    applyEvent(ev.agent_end([assistantFinal('Turno 1', 1000)]));
    expect(store.isStreaming$.value).toBe(false);

    // Evento tardío post Turno 1 descartado
    applyEvent(ev.message_update(assistantFinal('Turno 1', 1000), ''));
    expect(store.isStreaming$.value).toBe(false);

    // Turno 2 (nuevo prompt del usuario)
    beginStreamForSession(sessionPath);
    applyEvent(ev.agent_start());
    expect(store.isStreaming$.value).toBe(true);

    applyEvent(ev.agent_end([assistantFinal('Turno 2', 2000)]));
    expect(store.isStreaming$.value).toBe(false);
  });
});
