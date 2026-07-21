/**
 * model-picker.test.ts — Tests del ModelPicker (SolidJS).
 *
 * @vitest-environment jsdom
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';

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

vi.mock('xi-ui/lib/state.ts', () => ({
  appState: mockState.createMockAppState(),
}));

vi.mock('xi-ui/lib/pi/tauri-commands.ts', () => ({
  setModel: vi.fn(),
}));

import { ModelPicker } from '../../src/components/ModelPicker.tsx';
import { setModel } from 'xi-ui/lib/pi/tauri-commands.ts';

const { availableModels, currentModel } = mockState;

const modelGpt4o = { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', reasoning: false, contextWindow: 128000 };
const modelClaude = { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic', reasoning: false, contextWindow: 200000 };
const modelDeepseek = { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek', reasoning: true, contextWindow: 1000000 };

function renderPicker() {
  const onClose = vi.fn();
  const result = render(() => <ModelPicker onClose={onClose} />);
  return { ...result, onClose };
}

describe('ModelPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    availableModels.value = [];
    currentModel.value = null;
  });

  afterEach(() => cleanup());

  test('muestra titulo y search', () => {
    renderPicker();
    expect(screen.getByText('Seleccionar modelo')).toBeTruthy();
    expect(screen.getByPlaceholderText('Buscar modelo…')).toBeTruthy();
  });

  test('lista modelos de availableModels', () => {
    availableModels.value = [modelGpt4o, modelClaude];
    renderPicker();
    const items = screen.getAllByRole('button').filter((b) => b.classList.contains('model-picker-item'));
    expect(items.length).toBe(2);
  });

  test('muestra checkmark en modelo activo', () => {
    currentModel.value = modelGpt4o;
    availableModels.value = [modelGpt4o, modelClaude];
    renderPicker();
    expect(screen.getByText('✓')).toBeTruthy();
  });

  test('muestra contextWindow badge', () => {
    availableModels.value = [modelGpt4o, modelDeepseek];
    renderPicker();
    expect(screen.getByText('1M ctx')).toBeTruthy();
    expect(screen.getByText('128K ctx')).toBeTruthy();
  });

  test('search filtra modelos', async () => {
    availableModels.value = [modelGpt4o, modelClaude, modelDeepseek];
    renderPicker();
    const search = screen.getByPlaceholderText('Buscar modelo…') as HTMLInputElement;
    fireEvent.input(search, { target: { value: 'gpt' } });

    const items = screen.getAllByRole('button').filter((b) => b.classList.contains('model-picker-item'));
    expect(items.length).toBe(1);
    expect(items[0]?.textContent).toContain('GPT-4o');
  });

  test('click en item llama setModel y cierra', async () => {
    availableModels.value = [modelClaude, modelGpt4o];
    const { onClose } = renderPicker();

    const items = screen.getAllByRole('button').filter((b) => b.classList.contains('model-picker-item'));
    expect(items[0]?.textContent).toContain('Claude');
    fireEvent.click(items[0]);

    await vi.waitFor(() => {
      expect(setModel).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4');
      expect(onClose).toHaveBeenCalled();
    });
  });

  test('Escape cierra el modal', () => {
    const { onClose } = renderPicker();
    const search = screen.getByPlaceholderText('Buscar modelo…');
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  test('ArrowDown/Up actualiza item activo (clase)', () => {
    availableModels.value = [modelGpt4o, modelClaude, modelDeepseek];
    renderPicker();
    const search = screen.getByPlaceholderText('Buscar modelo…');

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });

    const items = screen.getAllByRole('button').filter((b) => b.classList.contains('model-picker-item'));
    expect(items[2]?.classList.contains('model-picker-item--active')).toBe(true);

    fireEvent.keyDown(search, { key: 'ArrowUp' });
    expect(items[1]?.classList.contains('model-picker-item--active')).toBe(true);
  });

  test('Enter selecciona el item navegado', async () => {
    availableModels.value = [modelGpt4o, modelClaude];
    const { onClose } = renderPicker();
    const search = screen.getByPlaceholderText('Buscar modelo…');

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });

    // select() es async con await setModel, esperar microtasks
    await vi.waitFor(() => {
      expect(setModel).toHaveBeenCalledWith('openai', 'gpt-4o');
      expect(onClose).toHaveBeenCalled();
    });
  });

  test('click en backdrop cierra', () => {
    const { onClose } = renderPicker();
    const backdrop = document.querySelector('.model-picker-backdrop')!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  test('footer muestra conteo de modelos', () => {
    availableModels.value = [modelGpt4o, modelClaude, modelDeepseek];
    renderPicker();
    expect(screen.getByText('3 modelos')).toBeTruthy();
  });

  test('footer se actualiza con search', () => {
    availableModels.value = [modelGpt4o, modelClaude, modelDeepseek];
    renderPicker();
    const search = screen.getByPlaceholderText('Buscar modelo…');
    fireEvent.input(search, { target: { value: 'gpt' } });
    expect(screen.getByText('1 modelo')).toBeTruthy();
  });
});
