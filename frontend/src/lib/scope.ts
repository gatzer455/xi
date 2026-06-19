/**
 * scope.ts — Agrupa disposers (cleanup functions) en una colección
 * que se pueden ejecutar todos juntos al desmontar un componente.
 *
 * Patrón de uso en una page (Capa 1):
 *
 *   export function SettingsPage(): Page {
 *     const root = document.createElement('div');
 *     const scope = createScope();
 *
 *     // ... render ...
 *
 *     // Cada subscribe a una signal retorna un unsubscriber.
 *     // Lo guardamos en el scope para ejecutarlo en dispose.
 *     scope.add(appState.configuredProviders.subscribe(updateProviderUI));
 *     scope.add(modelsLoading.subscribe(repaint));
 *
 *     return { root, dispose: () => scope.dispose() };
 *   }
 *
 * Por qué existe: si no se llama dispose, los callbacks quedan
 * vivos en el Set interno de cada signal. Si la page se desmonta
 * (porque el user navegó a otra vista), los callbacks viejos
 * siguen disparando — callbacks duplicados, memory leak de
 * elementos DOM referenciados por closures.
 *
 * El output-board llama `dispose` antes de cada `replaceChildren`,
 * así que cada vista solo tiene UNA ronda de suscripciones activas.
 */

export interface Scope {
  /** Registra un disposer. Se ejecutará cuando se llame a dispose(). */
  add(disposer: () => void): void;
  /** Ejecuta todos los disposers registrados y limpia el scope. */
  dispose(): void;
}

/** Interfaz que retornan las pages. `root` es el HTMLElement que se
 *  monta en el output-board; `dispose` se llama antes de desmontarlo
 *  para limpiar suscripciones y event listeners. */
export interface Page {
  root: HTMLElement;
  dispose: () => void;
}

export function createScope(): Scope {
  const disposers = new Set<() => void>();
  return {
    add(d) { disposers.add(d); },
    dispose() {
      for (const d of disposers) d();
      disposers.clear();
    },
  };
}
