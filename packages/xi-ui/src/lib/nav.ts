/**
 * nav.ts — Navegación entre vistas del output-board (browser-shaped).
 *
 * Reemplaza al router hash-based (router.ts). No hay URLs ni hash.
 * La navegación es mutación directa de `appState.currentView`; el
 * output-board se suscribe y re-renderiza.
 *
 * Una sola función `navigate` para que los call sites sean claros
 * y para tener un punto único si mañana agregamos historial o
 * transiciones.
 */

import { appState, type ViewName } from './state.ts';

export function navigate(view: ViewName): void {
  // Guardar la vista actual como anterior antes de cambiar.
  // Excepción: si ya estamos en settings, no sobreescribir —
  // el back button necesita saber de dónde vino originalmente.
  if (appState.currentView.value !== 'settings') {
    appState.previousView.value = appState.currentView.value;
  }
  appState.currentView.value = view;
}
