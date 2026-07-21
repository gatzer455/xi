/**
 * tests/setup.ts — Setup de vitest con mocks de APIs del browser
 * que jsdom no implementa (ResizeObserver, scrollIntoView, etc).
 *
 * Se carga antes de cada test file via `setupFiles` en vite.config.ts.
 * Algunos tests usan `// @vitest-environment node`, donde Element no
 * existe — las asignaciones a prototypes se guardan con typeof checks.
 */

// ResizeObserver: usado en ChatPage para auto-scroll.
// jsdom no lo implementa. Necesitamos un mock minimo que no crashee.
class MockResizeObserver {
  private callback: ResizeObserverCallback;
  private elements: Set<Element> = new Set();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    this.elements.add(target);
  }

  unobserve(target: Element): void {
    this.elements.delete(target);
  }

  disconnect(): void {
    this.elements.clear();
  }
}

// @ts-ignore — asignacion global para test environment
globalThis.ResizeObserver = MockResizeObserver;

// scrollIntoView: jsdom no lo implementa y algunas librerias lo usan.
// Guardado con typeof check porque algunos tests usan @vitest-environment node.
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = () => {
    // noop
  };
}

// matchMedia: jsdom no lo implementa.
if (typeof globalThis.matchMedia === "undefined") {
  Object.defineProperty(globalThis, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// Silenciar unhandled rejections de Tauri invoke en tests que no lo mockean
process.on('unhandledRejection', (err) => {
  // Tipo: Cannot read properties of undefined (reading 'invoke')
  // Es esperado en jsdom donde no hay Tauri runtime.
  if (err instanceof TypeError && err.message.includes("Cannot read properties of undefined")) {
    // ya fue, no reportar como error
  } else {
    // Otros errores no silenciados — registrarlos para que no pasen
    // desapercibidos.
    console.error('Unhandled rejection (not a Tauri mock issue):', err);
  }
});
