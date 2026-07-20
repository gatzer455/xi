/**
 * lifecycle.ts — Gestión del ciclo de vida del proceso pi.
 *
 * La función principal es `ensurePiRunning()`: garantiza que pi esté
 * corriendo antes de enviarle comandos. Es un guard que cualquier
 * página puede llamar antes de `getPiState()`, `getAvailableModels()`,
 * o cualquier comando que requiera el sidecar.
 *
 * El bug original: pi arranca, procesa una sesión, y termina (code 0).
 * Cuando el usuario navega a Settings o Sessions después, los comandos
 * fallaban con "pi process not running". Con `ensurePiRunning()`,
 * el sidecar se auto-arranca si no está vivo.
 *
 * Esta función vive en su propio módulo (no en tauri-commands.ts) porque
 * necesita importar `appState` (para obtener el workingDir). La regla
 * del paquete es que tauri-commands es un wrapper puro de invoke — no
 * conoce el state.
 */

import { getPiStatus, startPi } from 'xi-ui/lib/pi/tauri-commands.ts';
import { appState } from 'xi-ui/lib/state.ts';
import { addEntry } from 'xi-ui/lib/debug-panel.ts';
import { requestExtensionCommands } from 'xi-ui/lib/pi/slash-commands.ts';

/**
 * Asegura que pi esté corriendo. Si no lo está, lo arranca con el
 * workingDir actual (sin sesión — pi arranca en modo RPC limpio).
 *
 * Es seguro llamarlo múltiples veces: si pi ya corre, es no-op.
 * Si no hay workingDir seteado, loguea un warning y retorna sin
 * hacer nada (el caller verá el error al enviar el comando).
 */
export async function ensurePiRunning(): Promise<void> {
  try {
    const status = await getPiStatus();
    if (status.running) return;
  } catch (err) {
    addEntry(
      'system',
      `ensurePiRunning: getPiStatus falló, intentando startPi igual: ${err}`,
    );
  }

  const cwd = appState.workingDir.value;
  if (!cwd) {
    addEntry('system', 'ensurePiRunning: no hay workingDir, no se puede arrancar pi');
    return;
  }

  addEntry('system', 'ensurePiRunning: arrancando pi (no estaba corriendo)');
  await startPi(cwd);
  // Poblar el cache de slash commands de extensión/skill/prompt ahora
  // que pi acaba de iniciar. Fire-and-forget: la respuesta llega por
  // state-sync (case 'get_commands').
  requestExtensionCommands();
}
