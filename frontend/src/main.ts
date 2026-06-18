/**
 * main.ts — Entry point de xi
 *
 * App shell browser-shaped: 3 filas verticales.
 *   #top-bar      → Header() (logo, proyecto, tabs, settings)
 *   #output-board → OutputBoard() (welcome/chat/sessions/settings)
 *   #input-bar    → InputBar() (textarea + enviar)
 *
 * Sin sidebar, sin router hash-based. La navegación se maneja con
 * `appState.currentView` (ver lib/nav.ts).
 *
 * 1. Inicializar conexión con pi
 * 2. Cargar proyectos recientes
 * 3. Montar los 3 componentes del shell
 * 4. Decidir vista inicial (welcome o chat según si pi está corriendo)
 */

import { appState } from './lib/state.ts';
import { navigate } from './lib/nav.ts';
import { initPiConnection, getPiStatus, getRecents } from './lib/pi/index.ts';
import { Header } from './components/header.ts';
import { OutputBoard } from './components/output.ts';
import { InputBar } from './components/input.ts';
import { initDebugPanel, addEntry } from './lib/debug-panel.ts';
import {
  loadTheme,
  loadFontSize,
  applyThemeToDOM,
  applyFontToDOM,
} from './lib/settings-storage.ts';
import { getAvailableModels } from './lib/pi/tauri-commands.ts';
import { checkForUpdate, isUpdaterAvailable } from './lib/updater.ts';

// ═══════════════════════════════════════════════════════
// Inicializar
// ═══════════════════════════════════════════════════════

async function main(): Promise<void> {
  addEntry('system', 'xi starting...');

  // 0. ANTES del primer render: cargar tema y font de localStorage
  //    y aplicarlos al <html>. Sin esto hay FOUC (flash of unstyled
  //    content) cuando el OS y la preferencia del usuario no coinciden.
  const initialTheme = loadTheme();
  const initialFont = loadFontSize();
  applyThemeToDOM(initialTheme);
  applyFontToDOM(initialFont);
  appState.theme.value = initialTheme;
  appState.fontSize.value = initialFont;
  addEntry('system', `theme=${initialTheme} fontSize=${initialFont}`);

  // 1. Inicializar conexión con pi (escuchar eventos)
  await initPiConnection();
  addEntry('system', 'pi connection initialized');

  // 2. Verificar si pi ya está corriendo. Si running, restauramos
  //    su cwd y vamos directo a chat (restore on start).
  //    Si no, navegamos a welcome (xi es opinionated).
  let hasWorkingDir = false;
  try {
    const status = await getPiStatus();
    addEntry('system', `pi status: ${JSON.stringify(status)}`);
    if (status.running && status.cwd) {
      appState.workingDir.value = status.cwd;
      hasWorkingDir = true;
    }
  } catch (err) {
    addEntry('system', `Could not get pi status: ${err}`);
  }

  // 3. Cargar proyectos recientes. Se hace ANTES de montar el
  //    output board para que la welcome ya tenga `appState.recents`
  //    populado. Si falla, la welcome funciona sin grid.
  try {
    appState.recents.value = await getRecents();
    addEntry('system', `loaded ${appState.recents.value.length} recents`);
  } catch (err) {
    addEntry('system', `Could not load recents: ${err}`);
  }

  // 4. Carga lazy de modelos disponibles. Solo si pi está corriendo
  //    (si no, el comando no llega respuesta: la signal queda en []).
  //    El dropdown de settings muestra "Cargando modelos…" hasta que
  //    llegue la respuesta. Si nunca llega (pi caído), el usuario
  //    ve el estado de loading indefinidamente — mejor que mostrar
  //    error si el problema es transitorio (R20 del design).
  //
  //    NOTA: getAvailableModels NO espera la respuesta. El sidecar
  //    de pi responde via eventos, que state-sync procesa y popula
  //    `appState.availableModels`. Por eso este paso no tiene `await`.
  if (hasWorkingDir) {
    getAvailableModels();
    addEntry('system', 'requested available models');
  }

  // 5. Montar los 3 componentes del shell.
  document.getElementById('top-bar')!.append(Header());
  document.getElementById('output-board')!.append(OutputBoard());
  document.getElementById('input-bar')!.append(InputBar());

  // 6. Disparar el check de update 2.5s después del mount. El delay
  //    es para no competir con la carga de pi y del primer render:
  //    si la red está lenta, queremos que la UI esté usable antes
  //    de que un request de update la frene. Si el updater no está
  //    disponible (dev mode o build sin plugin), salimos silencioso.
  setTimeout(() => {
    if (!isUpdaterAvailable()) return;
    void checkForUpdate();
  }, 2500);

  // 7. Montar debug panel
  const debugContainer = initDebugPanel();
  document.body.append(debugContainer);

  // 8. Decidir vista inicial: si pi está corriendo con cwd, chat;
  //    si no, welcome. El default de currentView es 'welcome'.
  if (hasWorkingDir) {
    navigate('chat');
  }

  addEntry('system', 'xi ready');
}

main();
