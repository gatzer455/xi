/**
 * chat-context-bar.test.ts — Tests del ChatContextBar (Etapas 9–11).
 *
 * Verifica:
 * - Barra SIEMPRE visible; solo spinner + label se ocultan/muestran
 * - Spinner braille: arranca/detiene con appState.isStreaming
 * - Modelo: se actualiza con currentModel
 * - Token bar: calcula desde messages$ del store activo
 * - Barra de progreso visual
 * - dispose limpia todo
 *
 * @vitest-environment jsdom
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Mock appState (controllable signals) ─────────────────

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

  const isStreaming = mockSignal(false);
  const currentModel = mockSignal(null);
  const activeTabId = mockSignal<string | null>(null);

  return {
    createMockAppState: () => ({
      isStreaming,
      currentModel,
      activeTabId,
      thinkingLevel: mockSignal('medium'),
      availableModels: mockSignal([]),
      session: mockSignal(null),
    }),
    isStreaming,
    currentModel,
    activeTabId,
  };
});

vi.mock('../../src/lib/state.ts', () => ({
  appState: mockState.createMockAppState(),
}));

vi.mock('../../src/lib/debug-panel.ts', () => ({
  addEntry: vi.fn(),
}));

import { ChatContextBar } from '../../src/components/chat-context-bar.ts';

const { isStreaming, currentModel, activeTabId } = mockState;

describe('ChatContextBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    isStreaming.value = false;
    currentModel.value = null;
    activeTabId.value = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('root siempre visible (display != none)', () => {
    const cb = ChatContextBar();
    expect(cb.root.style.display).not.toBe('none');
    expect(cb.root.className).toBe('context-bar');
    cb.dispose();
  });

  test('label por defecto es "Trabajando…"', () => {
    const cb = ChatContextBar();
    expect(cb.root.querySelector('.context-bar-label')?.textContent).toBe('Trabajando…');
    cb.dispose();
  });

  test('spinner y label ocultos por defecto (isStreaming=false)', () => {
    const cb = ChatContextBar();
    const spinner = cb.root.querySelector<HTMLElement>('.context-bar-spinner')!;
    const label = cb.root.querySelector<HTMLElement>('.context-bar-label')!;
    expect(spinner.style.display).toBe('none');
    expect(label.style.display).toBe('none');
    cb.dispose();
  });

  test('isStreaming=true muestra spinner y label', () => {
    const cb = ChatContextBar();
    isStreaming.value = true;
    const spinner = cb.root.querySelector<HTMLElement>('.context-bar-spinner')!;
    const label = cb.root.querySelector<HTMLElement>('.context-bar-label')!;
    expect(spinner.style.display).not.toBe('none');
    expect(label.style.display).not.toBe('none');
    cb.dispose();
  });

  test('isStreaming=false oculta spinner y label', () => {
    const cb = ChatContextBar();
    isStreaming.value = true;
    isStreaming.value = false;
    const spinner = cb.root.querySelector<HTMLElement>('.context-bar-spinner')!;
    const label = cb.root.querySelector<HTMLElement>('.context-bar-label')!;
    expect(spinner.style.display).toBe('none');
    expect(label.style.display).toBe('none');
    cb.dispose();
  });

  test('el spinner cambia de frame tras 80ms cuando streaming', () => {
    const cb = ChatContextBar();
    isStreaming.value = true;
    const spinner = cb.root.querySelector('.context-bar-spinner')!;
    const before = spinner.textContent;
    vi.advanceTimersByTime(80);
    const after = spinner.textContent;
    expect(after).not.toBe(before);
    expect(after).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u);
    cb.dispose();
  });

  test('el spinner avanza 9+ frames únicos en un ciclo (800ms)', () => {
    const cb = ChatContextBar();
    isStreaming.value = true;
    const spinner = cb.root.querySelector('.context-bar-spinner')!;
    const frames: string[] = [spinner.textContent!];
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(80);
      frames.push(spinner.textContent!);
    }
    const uniq = new Set(frames);
    expect(uniq.size).toBeGreaterThanOrEqual(9);
    cb.dispose();
  });

  test('isStreaming=true dos veces no arranca segundo interval', () => {
    const cb = ChatContextBar();
    isStreaming.value = true;
    isStreaming.value = true;
    const spinner = cb.root.querySelector('.context-bar-spinner')!;
    const before = spinner.textContent;
    vi.advanceTimersByTime(80);
    expect(spinner.textContent).not.toBe(before);
    cb.dispose();
  });

  test('dispose detiene el interval (no más ticks)', () => {
    const cb = ChatContextBar();
    isStreaming.value = true;
    const spinner = cb.root.querySelector('.context-bar-spinner')!;
    cb.dispose();
    const afterDispose = spinner.textContent;
    vi.advanceTimersByTime(1000);
    expect(spinner.textContent).toBe(afterDispose);
  });

  test('modelo se actualiza con currentModel', () => {
    const cb = ChatContextBar();
    const btn = cb.root.querySelector<HTMLButtonElement>('.context-bar-model')!;
    expect(btn.textContent).toBe('sin modelo');

    currentModel.value = { id: 'gpt-4o', name: 'GPT-4o' };
    expect(btn.textContent).toBe('GPT-4o');

    currentModel.value = null;
    expect(btn.textContent).toBe('sin modelo');
    cb.dispose();
  });

  test('token bar nunca oculta aunque no haya messages', () => {
    const cb = ChatContextBar();
    // Sin activeTabId → token vacío pero barra visible
    const tokens = cb.root.querySelector('.context-bar-tokens')!;
    expect(tokens.textContent).toBe('');
    expect(tokens.style.display).not.toBe('none');
    cb.dispose();
  });

  test('boton modelo es un button clickeable con title', () => {
    const cb = ChatContextBar();
    const btn = cb.root.querySelector<HTMLButtonElement>('.context-bar-model')!;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.title).toBe('Cambiar modelo');
    cb.dispose();
  });

  test('dispose no tira error si se llama dos veces', () => {
    const cb = ChatContextBar();
    cb.dispose();
    expect(() => cb.dispose()).not.toThrow();
  });

  test('token bar y modelo visibles aunque isStreaming=false', () => {
    const cb = ChatContextBar();
    // La barra entera es visible, solo spinner+label ocultos
    expect(cb.root.querySelector('.context-bar-tokens')?.closest('.context-bar')).not.toBeNull();
    const modelBtn = cb.root.querySelector<HTMLButtonElement>('.context-bar-model')!;
    expect(modelBtn.textContent).toBe('sin modelo');
    cb.dispose();
  });
});