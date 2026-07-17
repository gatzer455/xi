/**
 * workdir.ts — Lógica unificada para abrir un proyecto.
 *
 * Centraliza el flujo "abrir un directorio y arrancar pi" para que
 * tanto la sidebar (botón de carpeta) como la welcome (CTA + cards)
 * llamen al mismo helper. Sin esta extracción, el handler del picker
 * estaba duplicado en sidebar.ts y tendría que duplicarse de nuevo
 * en welcome.ts.
 *
 * El orden importa: detenemos pi antes de cambiar `appState.workingDir`.
 * pi lee archivos del cwd durante su ejecución, y un cambio brusco lo
 * dejaría con un estado inconsistente. Matar primero, mutar después,
 * arrancar al final.
 */

import { open } from '@tauri-apps/plugin-dialog';
import { appState } from 'xi-ui/lib/state.ts';
import { stopPi } from './pi/index.ts';
import { addRecent } from 'xi-ui/lib/pi/tauri-commands.ts';
import { clearStores } from 'xi-ui/lib/chat/stores.ts';

/**
 * Abre un proyecto en un path dado. Mata pi, setea el state, arranca
 * pi en el nuevo cwd, y agrega el path a la lista de recientes.
 *
 * Si algo falla después del `startPi`, el error se propaga al caller
 * (la welcome lo muestra como banner; la sidebar lo loguea). El path
 * **no** se agrega a recents si `startPi` falla.
 */
export async function openProject(path: string): Promise<void> {
  // Si es la misma carpeta que ya tenemos abierta, no reiniciamos
  if (appState.workingDir.value === path) return;

  await stopPi();

  // Cerrar todas las tabs y sesiones — al cambiar de proyecto
  // las conversaciones anteriores no tienen sentido. Los mensajes
  // viven en ChatStores per-tab; los limpiamos todos.
  appState.openTabs.value = [];
  appState.activeTabId.value = null;
  appState.session.value = null;
  clearStores();

  appState.workingDir.value = path;

  addRecent(path).catch((err) => {
    console.error('Failed to save recent:', err);
  });
}

/**
 * Abre el picker nativo y, si el usuario selecciona algo, abre ese
 * proyecto. Si cancela, no hace nada.
 */
export async function pickAndOpenProject(): Promise<void> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Seleccionar carpeta de trabajo',
  });
  if (typeof selected !== 'string') return;
  await openProject(selected);
}
