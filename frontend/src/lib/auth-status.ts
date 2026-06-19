/**
 * auth-status.ts — Helper para cargar y cachear el estado de
 * providers LLM configurados en ~/.pi/agent/auth.json.
 *
 * El estado se consulta al mount de welcome y al volver de settings.
 * Después de un save o un test exitoso en settings, se re-carga
 * manualmente con refreshAuthStatus() para que la banderita de
 * welcome desaparezca cuando el user vuelve.
 *
 * El cache vive en una signal (no en localStorage) porque el
 * estado puede cambiar desde fuera de la app (el user edita
 * auth.json a mano, o usa `pi login` en la terminal).
 *
 * Por qué existe: queremos evitar que welcome y settings llamen
 * al backend cada vez que se renderizan. Una vez cargado, el
 * estado vive en signals hasta que algo explícitamente lo refresca.
 */

import { appState } from './state.ts';
import { getAuthStatus } from './pi/tauri-commands.ts';

/** Carga el estado de providers y popula las signals. Llamar al
 *  mount de welcome y al mount de settings. Fire-and-forget: no
 *  bloquea el render, las signals se actualizan cuando termina. */
export async function loadAuthStatus(): Promise<void> {
  const providers = await getAuthStatus();
  appState.configuredProviders.value = providers;
  appState.hasAnyProvider.value = providers.length > 0;
}

/** Re-carga el estado (alias de loadAuthStatus, semánticamente
 *  diferente: se llama después de un save o un cambio). */
export async function refreshAuthStatus(): Promise<void> {
  await loadAuthStatus();
}
