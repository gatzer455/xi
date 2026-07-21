/**
 * welcome.test.tsx — Smoke + contenido de WelcomePage (SolidJS).
 *
 * @vitest-environment jsdom
 */
import { describe, test, expect, vi } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';

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

  return {
    createMockAppState: () => ({
      hasAnyProvider: mockSignal(false),
      currentView: mockSignal('welcome'),
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
      activeTabId: mockSignal(null),
      session: mockSignal(null),
      isStreaming: mockSignal(false),
      currentModel: mockSignal(null),
      explorerPanelOpen: mockSignal(false),
      openTabs: mockSignal([]),
      availableModels: mockSignal([]),
      thinkingLevel: mockSignal('medium'),
      isCompacting: mockSignal(false),
      online: mockSignal(true),
      files: mockSignal([]),
      explorerPath: mockSignal(''),
      selectedFile: mockSignal(null),
      fileContent: mockSignal(null),
      isEditing: mockSignal(false),
      messages: mockSignal([]),
      streamingText: mockSignal(''),
      activeExtensionDialog: mockSignal(null),
      tabMessages: mockSignal({}),
    }),
  };
});

vi.mock('xi-ui/lib/state.ts', () => ({ appState: mock.createMockAppState() }));
vi.mock('xi-ui/lib/nav.ts', () => ({ navigate: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('xi-ui/lib/debug-panel.ts', () => ({ addEntry: vi.fn() }));
vi.mock('../../src/lib/auth-status.ts', () => ({ loadAuthStatus: vi.fn(() => Promise.resolve()) }));
vi.mock('../../src/lib/pi/index.ts', () => ({ getRecents: vi.fn(() => Promise.resolve([])), addRecent: vi.fn() }));

import { WelcomePage } from '../../src/pages/WelcomePage.tsx';

describe('WelcomePage', () => {
  afterEach(() => cleanup());

  test('mounts without error', () => {
    expect(() => render(() => <WelcomePage />)).not.toThrow();
  });

  test('shows welcome subtitle', () => {
    render(() => <WelcomePage />);
    expect(document.querySelector('.welcome-subtitle')).toBeTruthy();
  });

  test('shows recents section', () => {
    render(() => <WelcomePage />);
    expect(document.querySelector('.welcome-recents')).toBeTruthy();
  });

  test('shows help link', () => {
    render(() => <WelcomePage />);
    expect(document.querySelector('.welcome-help-link')).toBeTruthy();
  });

  test('shows auth banner when no provider', () => {
    render(() => <WelcomePage />);
    expect(document.querySelector('.welcome-auth-banner-btn')).toBeTruthy();
  });
});
