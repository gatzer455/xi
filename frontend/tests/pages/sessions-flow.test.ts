/**
 * sessions-flow.test.ts — Test de orden de llamadas en flujo de
 * sesión nueva.
 *
 * El bug (v0.1.1): al crear una sesión nueva, `syncPiSessionInBackground`
 * mandaba `new_session` a pi sin haberlo arrancado. El comando fallaba
 * con "pi process not running".
 *
 * El test verifica el invariante: `startPi` debe llamarse antes que
 * `newPiSession` cuando el usuario crea una conversación nueva desde
 * la página de sesiones.
 *
 * Aplica la regla de debuggability "test que expone el bug antes del
 * fix": si alguien revierte el fix (quita el startPi), este test
 * falla, reproduciendo el bug original.
 *
 * Nota: todo el setup de mocks usa vi.hoisted() porque vi.mock
 * factories se hoistean al tope del archivo y no pueden acceder
 * a variables del modulo.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ─── vi.hoisted: definido antes que los factories de vi.mock ──────────────

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

  // workingDir seteado — necesario para que createNewTab no
  // aborte con "Selecciona una carpeta de trabajo primero".
  const workingDir = mockSignal("/home/test/project");

  function createMockAppState() {
    return {
      workingDir,
      session: mockSignal(null),
      messages: mockSignal([]),
      isStreaming: mockSignal(false),
      streamingText: mockSignal(""),
      currentModel: mockSignal(null),
      thinkingLevel: mockSignal("medium" as const),
      isCompacting: mockSignal(false),
      online: mockSignal(true),
      currentView: mockSignal("sessions" as const),
      previousView: mockSignal("welcome" as const),
      files: mockSignal([]),
      explorerPath: mockSignal(""),
      selectedFile: mockSignal(null),
      fileContent: mockSignal(null),
      isEditing: mockSignal(false),
      openTabs: mockSignal([]),
      activeTabId: mockSignal(null),
      tabMessages: mockSignal({}),
      availableModels: mockSignal([]),
      theme: mockSignal("dark" as const),
      fontSize: mockSignal("medium" as const),
      updateStatus: mockSignal("idle" as const),
      updateReady: mockSignal(null),
      piVersion: mockSignal("unknown"),
      configuredProviders: mockSignal([]),
      recents: mockSignal([]),
      hasAnyProvider: mockSignal(true),
      updateDismissed: mockSignal(false),
      updateError: mockSignal(null),
      activeExtensionDialog: mockSignal(null),
    };
  }

  // Registro de llamadas a las funciones del paquete pi.
  // Cada entrada guarda el nombre de la función y el momento
  // relativo (índice incremental). El test compara los índices
  // para verificar el orden.
  const callLog: Array<{ name: string; index: number }> = [];
  let callCounter = 0;

  function track<T extends (...args: unknown[]) => unknown>(name: string): T {
    return ((...args: unknown[]) => {
      void args;
      const index = callCounter++;
      callLog.push({ name, index });
      return Promise.resolve();
    }) as T;
  }

  return { createMockAppState, workingDir, track, callLog };
});

// ─── vi.mock: factories que usan lo definido arriba ──────────────────────

vi.mock("../../src/lib/state.ts", () => ({
  appState: mock.createMockAppState(),
  setActiveTab: vi.fn(),
}));

vi.mock("../../src/lib/nav.ts", () => ({
  navigate: vi.fn(),
}));

// Mock del paquete pi: startPi y newPiSession trackean el orden.
// listSessions y el resto son no-ops async para no romper el flow.
vi.mock("../../src/lib/pi/index.ts", () => ({
  startPi: mock.track("startPi"),
  stopPi: mock.track("stopPi"),
  sendPrompt: mock.track("sendPrompt"),
  abortPi: mock.track("abortPi"),
  getPiState: mock.track("getPiState"),
  getPiMessages: mock.track("getPiMessages"),
  newPiSession: mock.track("newPiSession"),
  getPiStatus: vi.fn(() => Promise.resolve({ running: false, cwd: null })),
  listSessions: vi.fn(() =>
    Promise.resolve({ sessions: [], skipped: { count: 0, files: [] } }),
  ),
  deleteSession: vi.fn(() => Promise.resolve()),
  renameSession: vi.fn(() => Promise.resolve()),
  getRecents: vi.fn(() => Promise.resolve([])),
  addRecent: vi.fn(() => Promise.resolve()),
}));

import { SessionsPage, resetSessionsState } from "../../src/pages/sessions.ts";

describe("Flujo de sesión nueva — orden de llamadas", () => {
  beforeEach(() => {
    // Limpiar el registro de llamadas entre tests.
    mock.callLog.length = 0;
    mock.callLog.length = 0; // noop, verificación de idempotencia
    resetSessionsState();
  });

  test('click en "+ Nueva conversación" arranca pi ANTES de pedir sesión', async () => {
    const page = SessionsPage();

    // Buscar el botón "+ Nueva conversación" en el header.
    const newBtn = page.root.querySelector(".sessions-new");
    expect(newBtn).toBeTruthy();

    // Disparar el click — reproduce el flujo del usuario.
    (newBtn as HTMLButtonElement).click();

    // syncPiSessionInBackground es async. Esperar a que las
    // llamadas tracked se completen con un microtask flush.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // El invariante: startPi debe aparecer en el log antes que
    // newPiSession. Si alguien quita el "await startPi(cwd)" del
    // fix y solo deja newPiSession, este test falla.
    const startPiCall = mock.callLog.find((c) => c.name === "startPi");
    const newSessionCall = mock.callLog.find((c) => c.name === "newPiSession");

    expect(startPiCall, "startPi debió llamarse").toBeTruthy();
    expect(newSessionCall, "newPiSession debió llamarse").toBeTruthy();
    expect(
      startPiCall!.index,
      "startPi debe llamarse ANTES que newPiSession " +
        `(startPi=${startPiCall!.index}, newSession=${newSessionCall!.index})`,
    ).toBeLessThan(newSessionCall!.index);

    page.dispose();
  });
});
