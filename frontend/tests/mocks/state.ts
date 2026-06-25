/**
 * mocks/state.ts — Helpers para mockear signals y appState en tests.
 *
 * Uso:
 * ```typescript
 * import { vi } from 'vitest';
 * import { mockSignal, createMockAppState } from '../mocks/state.ts';
 *
 * vi.mock('../../src/lib/state.ts', () => ({
 *   appState: createMockAppState({ hasAnyProvider: false }),
 * }));
 * ```
 */

import type { Signal } from '../../src/lib/signal.ts';

/**
 * Crea una Signal<T> mockeada con valor inicial controlable.
 *
 * Se comporta como una signal real: `value` es getter/setter, y
 * `subscribe` llama al callback inmediatamente y retorna un disposer.
 */
export function mockSignal<T>(initial: T): Signal<T> {
  let value = initial;
  const subscribers = new Set<(v: T) => void>();

  return {
    get value() {
      return value;
    },
    set value(next: T) {
      if (next === value) return;
      value = next;
      subscribers.forEach(fn => fn(value));
    },
    subscribe(fn: (v: T) => void) {
      subscribers.add(fn);
      fn(value);
      return () => { subscribers.delete(fn); };
    },
  };
}

/**
 * Crea un mock de appState con solo los campos que los tests necesitan.
 *
 * Cada señal arranca con el valor default (o el override pasado).
 * Los campos no especificados en overrides toman valores por defecto
 * que no rompen el render de las paginas.
 */
export function createMockAppState(overrides: {
  hasAnyProvider?: boolean;
  workingDir?: string | null;
  currentModel?: { id: string; name: string } | null;
  recents?: Array<{ name: string; path: string; lastOpened: number }>;
}) {
  const hasAnyProvider = mockSignal(overrides.hasAnyProvider ?? false);
  const workingDir = mockSignal(overrides.workingDir ?? null);
  const currentModel = mockSignal(overrides.currentModel ?? null);
  const recents = mockSignal(overrides.recents ?? []);

  return {
    hasAnyProvider,
    workingDir,
    currentModel,
    recents,
    // Campos requeridos por las paginas pero que no afectan los tests
    session: mockSignal(null),
    messages: mockSignal([]),
    isStreaming: mockSignal(false),
    thinkingLevel: mockSignal('medium' as const),
    isCompacting: mockSignal(false),
    online: mockSignal(true),
    currentView: mockSignal('welcome' as const),
    previousView: mockSignal('welcome' as const),
    files: mockSignal([]),
    explorerPath: mockSignal(''),
    selectedFile: mockSignal(null),
    fileContent: mockSignal(null),
    isEditing: mockSignal(false),
    openTabs: mockSignal([]),
    activeTabId: mockSignal(null),
    tabMessages: mockSignal({}),
    availableModels: mockSignal([]),
    theme: mockSignal('dark' as const),
    fontSize: mockSignal('medium' as const),
    updateStatus: mockSignal('idle' as const),
    updateReady: mockSignal(null),
    piVersion: mockSignal('unknown'),
    configuredProviders: mockSignal([]),
    updateDismissed: mockSignal(false),
    updateError: mockSignal(null),
    activeExtensionDialog: mockSignal(null),
  };
}
