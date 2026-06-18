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

// ═══════════════════════════════════════════════════════
// Inicializar
// ═══════════════════════════════════════════════════════

async function main(): Promise<void> {
  addEntry('system', 'xi starting...');

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

  // 4. Montar los 3 componentes del shell.
  document.getElementById('top-bar')!.append(Header());
  document.getElementById('output-board')!.append(OutputBoard());
  document.getElementById('input-bar')!.append(InputBar());

  // 5. Montar debug panel
  const debugContainer = initDebugPanel();
  document.body.append(debugContainer);

  // 6. Decidir vista inicial: si pi está corriendo con cwd, chat;
  //    si no, welcome. El default de currentView es 'welcome'.
  if (hasWorkingDir) {
    navigate('chat');
  }

  addEntry('system', 'xi ready');
}

main();
