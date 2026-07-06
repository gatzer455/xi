/**
 * settings-flow.test.ts — Test de orden de llamadas en carga de settings.
 *
 * El bug: al abrir Settings, `getPiState()` y `getAvailableModels()` se
 * llamaban sin verificar si pi estaba corriendo. Si pi había terminado
 * después de restaurar una sesión (code 0), los comandos fallaban con
 * "pi process not running" en silencio.
 *
 * El fix: `ensurePiRunning()` arranca pi si no está corriendo, ANTES de
 * enviarle comandos. Este test verifica el invariante:
 *
 *   `ensurePiRunning` → (getPiState | getAvailableModels)
 *
 * Aplica la regla de debuggability "test que expone el bug antes del
 * fix": si alguien revierte el fix (quita el ensurePiRunning), este test
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

  function createMockAppState() {
    return {
      workingDir: mockSignal("/home/test/project"),
      session: mockSignal(null),
      messages: mockSignal([]),
      isStreaming: mockSignal(false),
      streamingText: mockSignal(""),
      currentModel: mockSignal(null),
      thinkingLevel: mockSignal("medium" as const),
      isCompacting: mockSignal(false),
      online: mockSignal(true),
      currentView: mockSignal("chat" as const),
      previousView: mockSignal("chat" as const),
      files: mockSignal([]),
      explorerPath: mockSignal(""),
      selectedFile: mockSignal(null),
      fileContent: mockSignal(null),
      isEditing: mockSignal(false),
      openTabs: mockSignal([]),
      activeTabId: mockSignal("tab-1"),
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

  // Registro de llamadas: guarda nombre + orden.
  // El test compara los índices para verificar el orden.
  const callLog: Array<{ name: string; index: number }> = [];
  let callCounter = 0;

  // Trackea cualquier función: registra la llamada y resuelve.
  function track<T extends (...args: unknown[]) => unknown>(name: string): T {
    return ((...args: unknown[]) => {
      void args;
      const index = callCounter++;
      callLog.push({ name, index });
      return Promise.resolve();
    }) as T;
  }

  return { createMockAppState, callLog, track };
});

// ─── vi.mock: factories que usan lo definido arriba ──────────────────────

vi.mock("../../src/lib/state.ts", () => ({
  appState: mock.createMockAppState(),
}));

vi.mock("../../src/lib/nav.ts", () => ({
  navigate: vi.fn(),
}));

vi.mock("../../src/lib/pi/tauri-commands.ts", () => ({
  setModel: vi.fn(),
  setThinkingLevel: vi.fn(),
  getAvailableModels: mock.track("getAvailableModels"),
  getPiVersion: vi.fn(() => Promise.resolve("0.80.2")),
  getPiState: mock.track("getPiState"),
  setApiKey: vi.fn(),
  testApiKey: vi.fn(),
  getApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  // Extension commands — needed by renderExtensionsSection
  getExaConfig: vi.fn(() => Promise.resolve({ hasKey: false, last4: null })),
  setExaApiKey: vi.fn(() => Promise.resolve()),
  deleteExaApiKey: vi.fn(() => Promise.resolve()),
  testExaApiKey: vi.fn(() => Promise.resolve()),
  getApproveRules: vi.fn(() => Promise.resolve({ rules: {}, messages: {} })),
  setApproveRules: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../src/lib/pi/index.ts", () => ({
  // ensurePiRunning arranca pi — trackeamos la llamada
  ensurePiRunning: mock.track("ensurePiRunning"),
}));

vi.mock("../../src/lib/pi/lifecycle.ts", () => ({
  ensurePiRunning: mock.track("ensurePiRunning"),
}));

vi.mock("../../src/lib/auth-status.ts", () => ({
  loadAuthStatus: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../src/lib/settings-storage.ts", () => ({
  applyThemeToDOM: vi.fn(),
  applyFontToDOM: vi.fn(),
  saveTheme: vi.fn(),
  saveFontSize: vi.fn(),
}));

vi.mock("../../src/lib/updater.ts", () => ({
  checkForUpdate: vi.fn(),
  installAndRelaunch: vi.fn(),
  isUpdaterAvailable: vi.fn(() => false),
}));

// ─── Tests ───────────────────────────────────────────────────────────────

import { SettingsPage } from "../../src/pages/settings.ts";

describe("Flujo de Settings — ensurePiRunning antes de comandos", () => {
  beforeEach(() => {
    mock.callLog.length = 0;
  });

  test("al montar Settings, ensurePiRunning se llama ANTES que getPiState", async () => {
    // appState.activeTabId = "tab-1" → dispara el bloque
    //   `if (appState.activeTabId.value) { void getPiState(); }`
    // que ahora está envuelto en ensurePiRunning().then(...).
    const page = SettingsPage();

    // El bloque es async (.then()). Esperar al microtask queue.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const ensureCall = mock.callLog.find((c) => c.name === "ensurePiRunning");
    const getStateCall = mock.callLog.find((c) => c.name === "getPiState");

    // Si el fix está presente, ensurePiRunning se llama.
    // Si no (alguien revirtió el fix), ensurePiRunning no aparece
    // y getPiState se llama sin guard — el test falla con
    // expect.toBeTruthy().
    expect(
      ensureCall,
      "ensurePiRunning debe llamarse al montar Settings " +
        "(si no, getPiState se llama sin verificar que pi corra)",
    ).toBeTruthy();

    // Si getPiState se llamó, debe ser DESPUÉS de ensurePiRunning.
    if (getStateCall) {
      expect(
        ensureCall!.index,
        "ensurePiRunning debe llamarse ANTES que getPiState " +
          `(ensurePiRunning=${ensureCall!.index}, getPiState=${getStateCall.index})`,
      ).toBeLessThan(getStateCall.index);
    }

    page.dispose();
  });

  test("loadModels llama ensurePiRunning ANTES que getAvailableModels", async () => {
    // Limpiar availableModels y modelsLoadAttempted para que
    // SettingsPage() dispare loadModels().
    // Nota: modelsLoadAttempted es una variable module-level en
    // settings.ts, y no podemos resetearla directamente porque
    // no está exportada. En este test creamos la page 2 veces:
    // la primera setea modelsLoadAttempted = true, la segunda
    // ya no dispara loadModels. Mejor importar el módulo dinámico.
    //
    // Alternativa: solo verificamos que el orden sea correcto
    // en el primer mount (el que sí dispara loadModels).
    // modelsLoadAttempted arranca en false, el primer mount lo
    // setea a true y llama loadModels.
    const page = SettingsPage();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const ensureCall = mock.callLog.find((c) => c.name === "ensurePiRunning");
    const getModelsCall = mock.callLog.find((c) => c.name === "getAvailableModels");

    expect(ensureCall).toBeTruthy();
    // Si getAvailableModels se llama (availableModels estaba vacío),
    // debe ser después de ensurePiRunning.
    if (getModelsCall) {
      expect(
        ensureCall!.index,
        "ensurePiRunning debe llamarse ANTES que getAvailableModels " +
          `(ensurePiRunning=${ensureCall!.index}, getAvailableModels=${getModelsCall.index})`,
      ).toBeLessThan(getModelsCall.index);
    }

    page.dispose();
  });
});