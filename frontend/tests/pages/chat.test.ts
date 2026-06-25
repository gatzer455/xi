/**
 * chat.test.ts — Smoke + contenido de ChatPage.
 *
 * Smoke: pagina monta sin excepcion.
 * Contenido: elementos principales existen en el DOM.
 * Estados: banner de auth visible/oculto segun hasAnyProvider.
 *
 * Nota: todo el setup de mocks usa vi.hoisted() porque vi.mock
 * factories se hoistean al tope del archivo y no pueden acceder
 * a variables del modulo. Todo lo que los factories necesiten
 * debe vivir dentro del return de vi.hoisted().
 */

import { describe, test, expect, vi } from "vitest";

// vi.hoisted() se ejecuta antes que los factories de vi.mock().
// Aca definimos mockSignal y las signals compartidas. Todo lo que
// los factories necesiten debe estar en este return.
const mock = vi.hoisted(() => {
  function mockSignal<T>(initial: T) {
    let value = initial;
    const subscribers = new Set<(v: T) => void>();
    return {
      get value() {
        return value;
      },
      set value(v: T) {
        if (v === value) return;
        value = v;
        subscribers.forEach((fn) => fn(value));
      },
      subscribe(fn: (v: T) => void) {
        subscribers.add(fn);
        fn(value);
        return () => subscribers.delete(fn);
      },
    };
  }

  const hasAnyProvider = mockSignal(false);

  function createMockAppState() {
    return {
      hasAnyProvider,
      activeExtensionDialog: mockSignal(null),
      session: mockSignal(null),
      messages: mockSignal([]),
      isStreaming: mockSignal(false),
      currentModel: mockSignal(null),
      thinkingLevel: mockSignal("medium"),
      isCompacting: mockSignal(false),
      online: mockSignal(true),
      currentView: mockSignal("chat"),
      previousView: mockSignal("welcome"),
      files: mockSignal([]),
      explorerPath: mockSignal(""),
      selectedFile: mockSignal(null),
      fileContent: mockSignal(null),
      isEditing: mockSignal(false),
      openTabs: mockSignal([]),
      activeTabId: mockSignal(null),
      tabMessages: mockSignal({}),
      availableModels: mockSignal([]),
      theme: mockSignal("dark"),
      fontSize: mockSignal("medium"),
      updateStatus: mockSignal("idle"),
      updateReady: mockSignal(null),
      piVersion: mockSignal("unknown"),
      configuredProviders: mockSignal([]),
      updateDismissed: mockSignal(false),
      updateError: mockSignal(null),
      workingDir: mockSignal(null),
      recents: mockSignal([]),
    };
  }

  return { createMockAppState, hasAnyProvider };
});

vi.mock("../../src/lib/state.ts", () => ({
  appState: mock.createMockAppState(),
}));

vi.mock("../../src/lib/pi/extension-ui-handler.ts", () => ({
  setDialogRenderer: vi.fn(),
  clearDialogRenderer: vi.fn(),
}));

import { ChatPage } from "../../src/pages/chat.ts";

describe("ChatPage", () => {
  beforeEach(() => {
    mock.hasAnyProvider.value = false;
  });

  test("mounts without error", () => {
    expect(() => {
      const page = ChatPage();
      expect(page.root).toBeInstanceOf(HTMLElement);
      expect(page.root.className).toBe("chat-area");
      page.dispose();
    }).not.toThrow();
  });

  test("renders header with title", () => {
    const page = ChatPage();
    expect(page.root.querySelector(".chat-header")).toBeTruthy();
    expect(page.root.querySelector(".chat-header-title")).toBeTruthy();
    page.dispose();
  });

  test("renders messages container", () => {
    const page = ChatPage();
    const msgs = page.root.querySelector(".chat-messages");
    expect(msgs).toBeTruthy();
    page.dispose();
  });

  test("shows auth banner when no provider configured", () => {
    mock.hasAnyProvider.value = false;
    const page = ChatPage();
    const banner = page.root.querySelector<HTMLElement>(".chat-auth-banner");
    expect(banner).toBeTruthy();
    expect(banner?.style.display).toBe("flex");
    expect(banner?.textContent).toContain("No hay modelo configurado");
    page.dispose();
  });

  test("hides auth banner when provider is configured", () => {
    mock.hasAnyProvider.value = true;
    const page = ChatPage();
    const banner = page.root.querySelector<HTMLElement>(".chat-auth-banner");
    expect(banner).toBeTruthy();
    expect(banner?.style.display).toBe("none");
    page.dispose();
  });

  test("auth banner visibility reacts to signal changes", () => {
    const page = ChatPage();
    const banner = page.root.querySelector<HTMLElement>(".chat-auth-banner");
    expect(banner).toBeTruthy();

    mock.hasAnyProvider.value = false;
    expect(banner?.style.display).toBe("flex");

    mock.hasAnyProvider.value = true;
    expect(banner?.style.display).toBe("none");

    mock.hasAnyProvider.value = false;
    expect(banner?.style.display).toBe("flex");

    page.dispose();
  });

  test("auth banner has navigate-to-settings button", () => {
    mock.hasAnyProvider.value = false;
    const page = ChatPage();
    const btn = page.root.querySelector<HTMLButtonElement>(
      ".chat-auth-banner-btn",
    );
    expect(btn).toBeTruthy();
    expect(btn?.textContent).toBe("Ir a Ajustes");
    page.dispose();
  });

  test("has no active extension dialog by default", () => {
    const page = ChatPage();
    expect(page.root.querySelector(".extension-dialog-wrapper")).toBeNull();
    page.dispose();
  });

  test("dispose cleans up subscriptions", () => {
    const page = ChatPage();
    page.dispose();
    expect(page.root.isConnected).toBe(false);
  });
});
