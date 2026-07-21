/**
 * chat.test.ts — Smoke + contenido de ChatPage (SolidJS).
 *
 * @vitest-environment jsdom
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@solidjs/testing-library';

const mock = vi.hoisted(() => {
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
        return () => subs.delete(fn);
      },
    };
  }

  const hasAnyProvider = mockSignal(false);
  const activeTabId = mockSignal<string | null>(null);

  return {
    createMockAppState: () => ({
      hasAnyProvider,
      activeTabId,
      activeExtensionDialog: mockSignal(null),
      session: mockSignal(null),
      isStreaming: mockSignal(false),
      currentModel: mockSignal(null),
      explorerPanelOpen: mockSignal(false),
      openTabs: mockSignal([]),
      availableModels: mockSignal([]),
      currentView: mockSignal('chat'),
      previousView: mockSignal('welcome'),
      workingDir: mockSignal(null),
      recents: mockSignal([]),
      theme: mockSignal('dark'),
      fontSize: mockSignal('medium'),
      updateStatus: mockSignal('idle'),
      updateReady: mockSignal(null),
      piVersion: mockSignal('unknown'),
      configuredProviders: mockSignal([]),
      updateDismissed: mockSignal(false),
      updateError: mockSignal(null),
      files: mockSignal([]),
      explorerPath: mockSignal(''),
      selectedFile: mockSignal(null),
      fileContent: mockSignal(null),
      isEditing: mockSignal(false),
      messages: mockSignal([]),
      streamingText: mockSignal(''),
      thinkingLevel: mockSignal('medium'),
      isCompacting: mockSignal(false),
      online: mockSignal(true),
      tabMessages: mockSignal({}),
    }),
    hasAnyProvider,
  };
});

vi.mock('xi-ui/lib/state.ts', () => ({ appState: mock.createMockAppState() }));
vi.mock('xi-ui/lib/chat/stores.ts', () => ({ getStore: vi.fn() }));
vi.mock('xi-ui/lib/nav.ts', () => ({ navigate: vi.fn() }));
vi.mock('xi-ui/components/extension-ui-dialog.ts', () => ({
  renderSelectDialog: vi.fn(),
  renderConfirmDialog: vi.fn(),
  renderInputDialog: vi.fn(),
  renderEditorDialog: vi.fn(),
}));
vi.mock('xi-ui/components/ChatMessages.tsx', () => {
  const ChatMessages = () => {
    const div = document.createElement('div');
    div.className = 'chat-messages';
    return div;
  };
  return {
    ChatMessages,
    createWrappedSignal: () => [() => [], () => {}],
  };
});
vi.mock('../../src/lib/pi/extension-ui-handler.ts', () => ({
  setDialogRenderer: vi.fn(),
  clearDialogRenderer: vi.fn(),
}));
vi.mock('./ExplorerPage.tsx', () => ({ mountExplorer: vi.fn() }));

import { ChatPage } from '../../src/pages/ChatPage.tsx';

describe('ChatPage', () => {
  afterEach(() => cleanup());

  test('mounts without error', () => {
    expect(() => render(() => <ChatPage />)).not.toThrow();
  });

  test('renders chat-messages container', () => {
    render(() => <ChatPage />);
    expect(document.querySelector('.chat-messages')).toBeTruthy();
  });

  test('shows auth banner when no provider', () => {
    mock.hasAnyProvider.value = false;
    render(() => <ChatPage />);
    const banner = document.querySelector('.chat-auth-banner');
    expect(banner).toBeTruthy();
    expect(banner?.textContent).toContain('No hay modelo');
  });

  test('hides auth banner when provider is configured', () => {
    mock.hasAnyProvider.value = true;
    render(() => <ChatPage />);
    // Con <Show when={!hasProvider()}>, el banner se remueve del DOM
    expect(document.querySelector('.chat-auth-banner')).toBeNull();
  });

  test('auth banner reacts to provider changes', () => {
    render(() => <ChatPage />);

    mock.hasAnyProvider.value = false;
    const banner = document.querySelector<HTMLElement>('.chat-auth-banner');
    expect(banner).not.toBeNull();
    expect(banner?.style.display).not.toBe('none');

    mock.hasAnyProvider.value = true;
    expect(document.querySelector('.chat-auth-banner')).toBeNull();

    mock.hasAnyProvider.value = false;
    expect(document.querySelector('.chat-auth-banner')).not.toBeNull();
  });

  test('auth banner has navigate-to-settings button', () => {
    mock.hasAnyProvider.value = false;
    render(() => <ChatPage />);
    const btn = document.querySelector<HTMLButtonElement>('.chat-auth-banner-btn');
    expect(btn).toBeTruthy();
    expect(btn?.textContent).toBe('Ir a Ajustes');
  });

  test('cleanup runs without error', () => {
    const { unmount } = render(() => <ChatPage />);
    expect(() => unmount()).not.toThrow();
  });
});
