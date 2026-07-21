/**
 * chat-context-bar.test.ts — Tests del ChatContextBar (Etapas 9–11).
 *
 * Verifica:
 * - Barra SIEMPRE visible; solo spinner + label se ocultan/muestran
 *   via visibility (preservan espacio, layout no salta).
 * - Spinner braille: arranca/detiene con appState.isStreaming.
 * - Modelo: se actualiza con currentModel.
 * - Token bar: usa usage.total del ÚLTIMO assistant message (no suma
 *   todos — eso daba el total histórico de facturación).
 * - Barra de progreso visual siempre accent.
 * - dispose limpia todo.
 *
 * @vitest-environment jsdom
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, createComponent } from 'solid-js/web';

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
  const currentView = mockSignal('chat');

  return {
    createMockAppState: () => ({
      isStreaming,
      currentModel,
      activeTabId,
      currentView,
      thinkingLevel: mockSignal('medium'),
      availableModels: mockSignal([]),
      session: mockSignal(null),
      explorerPanelOpen: mockSignal(false),
    }),
    isStreaming,
    currentModel,
    activeTabId,
    currentView,
  };
});

vi.mock('xi-ui/lib/state.ts', () => ({
  appState: mockState.createMockAppState(),
}));

vi.mock('xi-ui/lib/debug-panel.ts', () => ({
  addEntry: vi.fn(),
}));

import { ChatContextBar } from '../../src/components/ChatContextBar.tsx';

const { isStreaming, currentModel, activeTabId, currentView } = mockState;

function mount(): { root: HTMLElement; dispose: () => void } {
  const container = document.createElement('div');
  const dispose = render(() => createComponent(ChatContextBar, {}), container);
  return { root: container.firstElementChild as HTMLElement, dispose };
}

describe('ChatContextBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    isStreaming.value = false;
    currentModel.value = null;
    activeTabId.value = null;
    currentView.value = 'chat';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('root siempre visible (display != none)', () => {
    const cb = mount();
    expect(cb.root.style.display).not.toBe('none');
    expect(cb.root.className).toBe('context-bar');
    cb.dispose();
  });

  test('label por defecto es "Trabajando…"', () => {
    const cb = mount();
    expect(cb.root.querySelector('.context-bar-label')?.textContent).toBe('Trabajando…');
    cb.dispose();
  });

  test('spinner y label ocultos con visibility (no display) cuando isStreaming=false', () => {
    const cb = mount();
    const spinner = cb.root.querySelector<HTMLElement>('.context-bar-spinner')!;
    const label = cb.root.querySelector<HTMLElement>('.context-bar-label')!;
    // Preservan espacio (visibility:hidden) pero no son visibles
    expect(spinner.style.visibility).toBe('hidden');
    expect(spinner.style.display).not.toBe('none');
    expect(label.style.visibility).toBe('hidden');
    cb.dispose();
  });

  test('isStreaming=true cambia visibility a visible', () => {
    const cb = mount();
    isStreaming.value = true;
    const spinner = cb.root.querySelector<HTMLElement>('.context-bar-spinner')!;
    const label = cb.root.querySelector<HTMLElement>('.context-bar-label')!;
    expect(spinner.style.visibility).toBe('visible');
    expect(label.style.visibility).toBe('visible');
    cb.dispose();
  });

  test('isStreaming=false vuelve a visibility hidden', () => {
    const cb = mount();
    isStreaming.value = true;
    isStreaming.value = false;
    const spinner = cb.root.querySelector<HTMLElement>('.context-bar-spinner')!;
    const label = cb.root.querySelector<HTMLElement>('.context-bar-label')!;
    expect(spinner.style.visibility).toBe('hidden');
    expect(label.style.visibility).toBe('hidden');
    cb.dispose();
  });

  test('el spinner cambia de frame tras 80ms cuando streaming', () => {
    const cb = mount();
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
    const cb = mount();
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
    const cb = mount();
    isStreaming.value = true;
    isStreaming.value = true;
    const spinner = cb.root.querySelector('.context-bar-spinner')!;
    const before = spinner.textContent;
    vi.advanceTimersByTime(80);
    expect(spinner.textContent).not.toBe(before);
    cb.dispose();
  });

  test('dispose detiene el interval (no más ticks)', () => {
    const cb = mount();
    isStreaming.value = true;
    const spinner = cb.root.querySelector('.context-bar-spinner')!;
    cb.dispose();
    const afterDispose = spinner.textContent;
    vi.advanceTimersByTime(1000);
    expect(spinner.textContent).toBe(afterDispose);
  });

  test('modelo se actualiza con currentModel', () => {
    const cb = mount();
    const btn = cb.root.querySelector<HTMLButtonElement>('.context-bar-model')!;
    expect(btn.textContent).toBe('sin modelo');

    currentModel.value = { id: 'gpt-4o', name: 'GPT-4o' };
    expect(btn.textContent).toBe('GPT-4o');

    currentModel.value = null;
    expect(btn.textContent).toBe('sin modelo');
    cb.dispose();
  });

  test('token bar vacía sin activeTabId', () => {
    const cb = mount();
    const tokens = cb.root.querySelector('.context-bar-tokens')!;
    expect(tokens.textContent).toBe('');
    cb.dispose();
  });

  test('boton modelo es un button clickeable con title', () => {
    const cb = mount();
    const btn = cb.root.querySelector<HTMLButtonElement>('.context-bar-model')!;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.title).toBe('Cambiar modelo');
    cb.dispose();
  });

  test('dispose no tira error si se llama dos veces', () => {
    const cb = mount();
    cb.dispose();
    expect(() => cb.dispose()).not.toThrow();
  });

  test('token bar y modelo visibles aunque isStreaming=false', () => {
    const cb = mount();
    const tokens = cb.root.querySelector('.context-bar-tokens')!;
    expect(tokens.textContent).toBe('');
    const modelBtn = cb.root.querySelector<HTMLButtonElement>('.context-bar-model')!;
    expect(modelBtn.textContent).toBe('sin modelo');
    cb.dispose();
  });

  test('visible solo en vista chat (oculta en sessions/settings/welcome)', () => {
    const cb = mount();
    expect(cb.root.style.display).not.toBe('none');

    // Cambiar a otra vista → se oculta
    currentView.value = 'sessions';
    expect(cb.root.style.display).toBe('none');

    // Volver a chat → visible
    currentView.value = 'chat';
    expect(cb.root.style.display).not.toBe('none');

    cb.dispose();
  });

  test('progress bar fill NO tiene hsl (el verde/rojo viejo)', () => {
    const cb = mount();
    const fill = cb.root.querySelector<HTMLElement>('.context-bar-progress-fill')!;
    // El CSS del componente ya pone background: var(--color-accent) por
    // clase. El inline style solo se actualiza cuando hay activeTabId.
    // Lo que verificamos es que NO tenga el hue dinámico viejo (hsl).
    const style = fill.getAttribute('style') ?? '';
    expect(style).not.toContain('hsl');
    cb.dispose();
  });
});