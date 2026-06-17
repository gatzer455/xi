/**
 * main.ts — Entry point de xi
 *
 * 1. Inicializar conexión con pi
 * 2. Montar sidebar y debug panel
 * 3. Registrar rutas
 * 4. Inicializar router
 */

import { initRouter, route } from './router.ts';
import { initPiConnection, getPiStatus, getRecents } from './lib/pi/index.ts';
import { appState } from './lib/state.ts';
import { Sidebar } from './components/sidebar.ts';
import { ChatPage } from './pages/chat.ts';
import { SettingsPage } from './pages/settings.ts';
import { SessionsPage } from './pages/sessions.ts';
import { WelcomePage } from './pages/welcome.ts';
import { initDebugPanel, addEntry } from './lib/debug-panel.ts';

// ═══════════════════════════════════════════════════════
// Registrar rutas
// ═══════════════════════════════════════════════════════

route('#/welcome', () => WelcomePage());
route('#/chat', () => ChatPage());
route('#/settings', () => SettingsPage());
route('#/sessions', () => SessionsPage());

// ═══════════════════════════════════════════════════════
// Inicializar
// ═══════════════════════════════════════════════════════

async function main(): Promise<void> {
  addEntry('system', 'xi starting...');

  // 1. Inicializar conexión con pi (escuchar eventos)
  await initPiConnection();
  addEntry('system', 'pi connection initialized');

  // 2. Verificar si pi ya está corriendo. Si running, restauramos
  //    su cwd y vamos directo a #/chat (restore on start).
  //    Si no, navegamos a #/welcome (xi es opinionated).
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

  // 3. Cargar proyectos recientes. Se hace ANTES de initRouter
  //    para que cuando la welcome se monte, `appState.recents.value`
  //    ya esté populado. Si falla, la welcome funciona sin grid.
  try {
    appState.recents.value = await getRecents();
    addEntry('system', `loaded ${appState.recents.value.length} recents`);
  } catch (err) {
    addEntry('system', `Could not load recents: ${err}`);
  }

  // 4. Montar sidebar (la welcome la oculta; las otras rutas la muestran)
  const sidebarContainer = document.getElementById('nav-header')!;
  sidebarContainer.append(Sidebar());

  // 5. Montar debug panel
  const debugContainer = initDebugPanel();
  document.body.append(debugContainer);

  // 6. Inicializar router. Pasa el id del sidebar para que el router
  //    pueda mostrar/ocultarlo según la ruta.
  initRouter('outlet', 'nav-header');

  // 7. Decidir navegación: si pi está corriendo, vamos a #/chat;
  //    si no, a #/welcome. El router usa #/welcome como default, así
  //    que solo necesitamos forzar #/chat cuando hay workingDir.
  if (hasWorkingDir) {
    location.hash = '#/chat';
  }

  addEntry('system', 'xi ready');
}

main();
