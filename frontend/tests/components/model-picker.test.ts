/**
 * model-picker.test.ts — Tests del ModelPicker modal (Etapa 10).
 *
 * Verifica:
 * - Modal se abre y cierra
 * - Muestra modelos desde availableModels
 * - Search filtra
 * - Keyboard navigation
 * - Click en backdrop cierra
 * - Select llama setModel
 * - Muestra checkmark en modelo activo
 * - Muestra context window badge
 *
 * @vitest-environment jsdom
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

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

  const availableModels = mockSignal<any[]>([]);
  const currentModel = mockSignal<any>(null);

  return {
    createMockAppState: () => ({
      availableModels,
      currentModel,
      isStreaming: mockSignal(false),
      activeTabId: mockSignal(null),
      thinkingLevel: mockSignal('medium'),
      session: mockSignal(null),
    }),
    availableModels,
    currentModel,
  };
});

vi.mock('../../src/lib/state.ts', () => ({
  appState: mockState.createMockAppState(),
}));

vi.mock('../../src/lib/pi/tauri-commands.ts', () => ({
  setModel: vi.fn(),
}));

vi.mock('../../src/lib/debug-panel.ts', () => ({
  addEntry: vi.fn(),
}));

import { ModelPicker } from '../../src/components/model-picker.ts';
import { setModel } from '../../src/lib/pi/tauri-commands.ts';

const { availableModels, currentModel } = mockState;

// ─── Fixture models ───────────────────────────────────────

const modelGpt4o = {
  id: 'gpt-4o', name: 'GPT-4o', provider: 'openai',
  reasoning: false, contextWindow: 128000,
};
const modelGpt4oMini = {
  id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai',
  reasoning: false, contextWindow: 128000,
};
const modelClaude = {
  id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic',
  reasoning: false, contextWindow: 200000,
};
const modelDeepseek = {
  id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek',
  reasoning: true, contextWindow: 1000000,
};

describe('ModelPicker', () => {
  beforeEach(() => {
    availableModels.value = [];
    currentModel.value = null;
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('se abre y agrega backdrop al body', () => {
    availableModels.value = [modelGpt4o];
    const picker = ModelPicker();
    const backdrop = document.querySelector('.model-picker-backdrop');
    expect(backdrop).toBeTruthy();
    picker.dispose();
  });

  test('dispose remueve el backdrop del DOM', () => {
    availableModels.value = [modelGpt4o];
    const picker = ModelPicker();
    expect(document.querySelector('.model-picker-backdrop')).toBeTruthy();
    picker.dispose();
    expect(document.querySelector('.model-picker-backdrop')).toBeNull();
  });

  test('click en backdrop cierra el modal', () => {
    availableModels.value = [modelGpt4o];
    const picker = ModelPicker();
    const backdrop = document.querySelector('.model-picker-backdrop')!;
    backdrop.dispatchEvent(new MouseEvent('click'));
    expect(document.querySelector('.model-picker-backdrop')).toBeNull();
  });

  test('lista modelos de availableModels', () => {
    availableModels.value = [modelGpt4o, modelClaude];
    const picker = ModelPicker();
    const items = document.querySelectorAll('.model-picker-item');
    expect(items.length).toBe(2);
    picker.dispose();
  });

  test('agrupa por provider', () => {
    availableModels.value = [modelGpt4o, modelGpt4oMini, modelClaude];
    const picker = ModelPicker();
    const groups = document.querySelectorAll('.model-picker-group');
    // anthropic + openai = 2 grupos (orden alfabetico)
    expect(groups.length).toBe(2);
    expect(groups[0]?.textContent).toBe('anthropic');
    expect(groups[1]?.textContent).toBe('openai');
    picker.dispose();
  });

  test('muestra checkmark en modelo activo', () => {
    currentModel.value = modelGpt4o;
    availableModels.value = [modelGpt4o, modelClaude];
    const picker = ModelPicker();
    const checks = document.querySelectorAll('.model-picker-item-check');
    expect(checks.length).toBe(1);
    expect(checks[0]?.textContent).toBe('✓');
    picker.dispose();
  });

  test('muestra contextWindow badge', () => {
    availableModels.value = [modelGpt4o, modelDeepseek];
    const picker = ModelPicker();
    const ctxBadges = document.querySelectorAll('.model-picker-item-ctx');
    // deepseek < openai alfabeticamente → deepseek primero
    expect(ctxBadges.length).toBe(2);
    expect(ctxBadges[0]?.textContent).toContain('1M');
    expect(ctxBadges[1]?.textContent).toContain('128K');
    picker.dispose();
  });

  test('search filtra modelos', () => {
    availableModels.value = [modelGpt4o, modelClaude, modelDeepseek];
    const picker = ModelPicker();
    const search = document.querySelector<HTMLInputElement>('.model-picker-search')!;
    
    // Simular input de busqueda
    search.value = 'gpt';
    search.dispatchEvent(new Event('input'));

    const items = document.querySelectorAll('.model-picker-item');
    expect(items.length).toBe(1);
    expect(items[0]?.textContent).toContain('GPT-4o');
    picker.dispose();
  });

  test('click en item llama setModel y cierra', () => {
    availableModels.value = [modelClaude, modelGpt4o];
    const picker = ModelPicker();

    const items = document.querySelectorAll('.model-picker-item');
    // anthropic < openai → Claude primero
    expect(items[0]?.textContent).toContain('Claude');

    // Click en Claude
    (items[0] as HTMLElement).click();

    expect(setModel).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4');
    expect(document.querySelector('.model-picker-backdrop')).toBeNull();
  });

  test('Escape cierra el modal', () => {
    availableModels.value = [modelGpt4o];
    const picker = ModelPicker();
    const search = document.querySelector<HTMLInputElement>('.model-picker-search')!;
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.model-picker-backdrop')).toBeNull();
  });

  test('ArrowDown/Up navega entre items', () => {
    availableModels.value = [modelGpt4o, modelClaude, modelDeepseek];
    const picker = ModelPicker();
    const search = document.querySelector<HTMLInputElement>('.model-picker-search')!;

    // ArrowDown dos veces → focus en tercer item
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

    const items = document.querySelectorAll('.model-picker-item');
    expect(document.activeElement).toBe(items[2]);

    // ArrowUp una vez → focus en segundo item
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(document.activeElement).toBe(items[1]);

    picker.dispose();
  });

  test('Enter selecciona el item navegado', () => {
    availableModels.value = [modelGpt4o, modelClaude];
    const picker = ModelPicker();
    const search = document.querySelector<HTMLInputElement>('.model-picker-search')!;

    // Primer item es Claude (antrhopic < openai)
    // ArrowDown navega al segundo item (GPT-4o)
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    // Enter selecciona el item 1 (GPT-4o)
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(setModel).toHaveBeenCalledWith('openai', 'gpt-4o');
    picker.dispose();
  });

  test('footer muestra conteo de modelos', () => {
    availableModels.value = [modelGpt4o, modelClaude, modelDeepseek];
    const picker = ModelPicker();
    const footer = document.querySelector('.model-picker-footer')!;
    expect(footer.textContent).toContain('3');
    picker.dispose();
  });

  test('footer se actualiza con search', () => {
    availableModels.value = [modelGpt4o, modelClaude, modelDeepseek];
    const picker = ModelPicker();
    const search = document.querySelector<HTMLInputElement>('.model-picker-search')!;
    const footer = document.querySelector('.model-picker-footer')!;

    search.value = 'gpt';
    search.dispatchEvent(new Event('input'));
    expect(footer.textContent).toContain('1 modelo');

    picker.dispose();
  });
});