/**
 * main.ts — Entry point de xi
 *
 * 1. Inicializar conexión con pi
 * 2. Montar sidebar y debug panel
 * 3. Registrar rutas
 * 4. Inicializar router
 */

import { initRouter, route } from './router.ts';
import { initPiConnection, getPiStatus } from './lib/pi/index.ts';
import { appState } from './lib/state.ts';
import { Sidebar } from './components/sidebar.ts';
import { ChatPage } from './pages/chat.ts';
import { SettingsPage } from './pages/settings.ts';
import { SessionsPage } from './pages/sessions.ts';
import { initDebugPanel, addEntry } from './lib/debug-panel.ts';

// ═══════════════════════════════════════════════════════
// Registrar rutas
// ═══════════════════════════════════════════════════════

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

  // 2. Verificar si pi ya está corriendo
  try {
    const status = await getPiStatus();
    addEntry('system', `pi status: ${JSON.stringify(status)}`);
    if (status.running && status.cwd) {
      appState.workingDir.value = status.cwd;
    }
  } catch (err) {
    addEntry('system', `Could not get pi status: ${err}`);
  }

  // 3. Montar sidebar
  const sidebarContainer = document.getElementById('nav-header')!;
  sidebarContainer.append(Sidebar());

  // 4. Montar debug panel
  const debugContainer = initDebugPanel();
  document.body.append(debugContainer);

  // 5. Inicializar router
  initRouter('outlet');
  addEntry('system', 'xi ready');
}

main();
