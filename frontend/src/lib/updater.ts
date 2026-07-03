/**
 * updater.ts — wrapper sobre los plugins de Tauri para auto-update.
 *
 * Por qué existe: la app debe actualizarse sola sin que el user haga
 * nada (es infraestructura de soporte, no feature). El flow está
 * diseñado para ser invisible hasta que el update está listo: el
 * check se dispara una vez al iniciar, la descarga ocurre en
 * background, y un banner minimalista aparece solo cuando el user
 * puede actuar. Si algo falla, la app sigue funcionando con la
 * versión actual — el update es nice-to-have, no bloqueante.
 *
 * Capa 2 (Lib): sin DOM, solo actualiza signals. La UI (top bar,
 * settings) se suscribe y se re-pinta sola.
 */

import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { appState } from './state.ts';
import { addEntry } from './debug-panel.ts';

/** Chequea si hay update disponible. Si hay, dispara download silencioso.
 *  Idempotente: si ya hay un check en curso, retorna sin hacer nada. */
export async function checkForUpdate(): Promise<void> {
  // Sin esto, dos clicks rápidos en "Buscar actualización" en settings
  // harían dos requests paralelos. El segundo check no aporta info.
  if (appState.updateStatus.value === 'checking') return;

  appState.updateStatus.value = 'checking';
  appState.updateError.value = null;

  const update = await tryCheck();
  if (update === undefined) return;  // error path: tryCheck ya seteó updateStatus

  if (update === null) {
    // No hay update. El user no se entera — el status vuelve a idle
    // y nadie lo renderiza.
    appState.updateStatus.value = 'idle';
    return;
  }

  appState.updateReady.value = {
    version: update.version,
    body: update.body ?? '',
    date: update.date ?? null,
  };
  addEntry('system', `update available: v${update.version}`);
  void downloadUpdate(update);
}

/** Encapsula el try/catch del check para que `checkForUpdate` quede
 *  plano (sin try anidado en su happy path). Retorna el Update, null
 *  si no hay, o undefined si hubo error (en cuyo caso ya setea signals). */
async function tryCheck(): Promise<Update | null | undefined> {
  try {
    return await check();
  } catch (err) {
    // Errores de red, server caído, o build sin updater. La app sigue
    // normal — el user solo ve el error si va a settings a mirar.
    appState.updateStatus.value = 'error';
    appState.updateError.value = err instanceof Error ? err.message : String(err);
    addEntry('system', `update check failed: ${appState.updateError.value}`);
    return undefined;
  }
}

/** Descarga el update en background. La verificación de firma es
 *  built-in en el plugin: si falla, el bundle se descarta y
 *  downloadAndInstall() throws. Por eso un error acá puede ser
 *  tanto de red como de firma. */
async function downloadUpdate(update: Update): Promise<void> {
  appState.updateStatus.value = 'downloading';
  try {
    await update.downloadAndInstall();
    appState.updateStatus.value = 'ready';
    addEntry('system', `update v${update.version} installed, ready to relaunch`);
  } catch (err) {
    appState.updateStatus.value = 'error';
    appState.updateError.value = err instanceof Error ? err.message : String(err);
    addEntry('system', `update download failed: ${appState.updateError.value}`);
  }
}

/** Cierra la app y la reabre con la nueva versión. No retorna: el
 *  proceso se mata durante relaunch. Si falla, el error lo ve el
 *  caller (no un catch aquí, porque no hay nada que catchear
 *  después de que el proceso muere). */
export function installAndRelaunch(): Promise<void> {
  return relaunch();
}

/** Marca el banner como dismissed. El banner no vuelve a aparecer
 *  hasta el próximo launch, cuando fresh start resetea el state.
 *  Decisión deliberada: si el user está chateando y no quiere
 *  reiniciar, "Después" tiene que ser una opción real, no un
 *  mensaje que se reinmuta cada 30 segundos. */
export function dismissBanner(): void {
  appState.updateDismissed.value = true;
}

/** Helper defensivo: chequea si el plugin de updater está disponible.
 *  En dev mode o builds sin el plugin, las funciones de Tauri pueden
 *  no estar registradas. Usar antes de checkForUpdate para no spamear
 *  errores en consola durante `npm run dev`. */
export function isUpdaterAvailable(): boolean {
  return typeof window !== 'undefined'
    && '__TAURI_INTERNALS__' in window
    && !isDevMode();
}

/** Detecta si estamos en modo desarrollo (npm run dev / tauri dev).
 *  En dev, el updater no debe correr porque no hay release publicado.
 *  Usa import.meta.env.DEV de Vite — en prod builds se inlinea a false. */
function isDevMode(): boolean {
  try {
    return (import.meta as any).env?.DEV === true;
  } catch {
    return false;
  }
}
