/**
 * welcome.test.ts — Smoke + contenido de WelcomePage.
 *
 * Smoke: pagina monta sin excepcion.
 * Contenido: elementos principales existen en el DOM.
 */
import { describe, test, expect, vi } from "vitest";

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

  return {
    mockSignal,
    recentProjects: mockSignal(
      [] as Array<{ name: string; path: string; lastOpened: number }>,
    ),
  };
});

vi.mock("../../src/lib/state.ts", () => ({
  appState: {
    recents: mock.recentProjects,
    workingDir: mock.mockSignal(null),
    hasAnyProvider: mock.mockSignal(false),
    session: mock.mockSignal(null),
    messages: mock.mockSignal([]),
    isStreaming: mock.mockSignal(false),
    currentModel: mock.mockSignal(null),
    thinkingLevel: mock.mockSignal("medium"),
    isCompacting: mock.mockSignal(false),
    online: mock.mockSignal(true),
    currentView: mock.mockSignal("welcome"),
    previousView: mock.mockSignal("welcome"),
    files: mock.mockSignal([]),
    explorerPath: mock.mockSignal(""),
    selectedFile: mock.mockSignal(null),
    fileContent: mock.mockSignal(null),
    isEditing: mock.mockSignal(false),
    openTabs: mock.mockSignal([]),
    activeTabId: mock.mockSignal(null),
    tabMessages: mock.mockSignal({}),
    availableModels: mock.mockSignal([]),
    theme: mock.mockSignal("dark"),
    fontSize: mock.mockSignal("medium"),
    updateStatus: mock.mockSignal("idle"),
    updateReady: mock.mockSignal(null),
    piVersion: mock.mockSignal("unknown"),
    configuredProviders: mock.mockSignal([]),
    updateDismissed: mock.mockSignal(false),
    updateError: mock.mockSignal(null),
    activeExtensionDialog: mock.mockSignal(null),
  },
}));

// Mock de loadAuthStatus para que no intente cargar providers reales
vi.mock("../../src/lib/auth-status.ts", () => ({
  loadAuthStatus: vi.fn(() => Promise.resolve()),
}));

// Mock de pi/index para evitar llamadas IPC
vi.mock("../../src/lib/pi/index.ts", () => ({
  getRecents: vi.fn(() => Promise.resolve([])),
  addRecent: vi.fn(),
}));

import { WelcomePage } from "../../src/pages/welcome.ts";

describe("WelcomePage", () => {
  test("mounts without error", () => {
    expect(() => {
      const page = WelcomePage();
      expect(page.root).toBeInstanceOf(HTMLElement);
      expect(page.root.className).toBe("welcome-page");
      page.dispose();
    }).not.toThrow();
  });

  test("renders header section", () => {
    const page = WelcomePage();
    expect(page.root.querySelector(".welcome-header")).toBeTruthy();
    page.dispose();
  });

  test("renders CTA button", () => {
    const page = WelcomePage();
    const cta = page.root.querySelector<HTMLElement>(".welcome-cta");
    expect(cta).toBeTruthy();
    expect(cta?.textContent).toContain("Seleccioná una carpeta primero");
    page.dispose();
  });

  test("renders help link", () => {
    const page = WelcomePage();
    const help =
      page.root.querySelector<HTMLAnchorElement>(".welcome-help-link");
    expect(help).toBeTruthy();
    expect(help?.href).toContain("pi.dev/docs");
    page.dispose();
  });

  test("renders recents section", () => {
    const page = WelcomePage();
    const recents = page.root.querySelector(".welcome-recents");
    expect(recents).toBeTruthy();
    page.dispose();
  });

  test("renders error banner (hidden)", () => {
    const page = WelcomePage();
    const error = page.root.querySelector<HTMLElement>(".welcome-error");
    expect(error).toBeTruthy();
    expect(error?.style.display).toBe("none");
    page.dispose();
  });

  test("shows recents when there are recent projects", () => {
    mock.recentProjects.value = [
      {
        name: "proyecto-1",
        path: "/home/user/proyecto-1",
        lastOpened: Date.now(),
      },
    ];
    const page = WelcomePage();
    const card = page.root.querySelector(".recent-card");
    expect(card).toBeTruthy();
    expect(card?.textContent).toContain("proyecto-1");
    page.dispose();
  });

  test("hides recents section when empty", () => {
    mock.recentProjects.value = [];
    const page = WelcomePage();
    const section = page.root.querySelector<HTMLElement>(".welcome-recents");
    expect(section?.style.display).toBe("none");
    page.dispose();
  });

  test("dispose removes subscriptions", () => {
    const page = WelcomePage();
    page.dispose();
    expect(page.root.isConnected).toBe(false);
  });
});
