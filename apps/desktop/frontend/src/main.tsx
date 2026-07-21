/**
 * main.ts — Entry point de xi
 *
 * App shell: 2 bloques verticales.
 *   #top-bar      → Header() (logo, proyecto, tabs, settings)
 *   #output-board → OutputBoard() (welcome/chat/sessions/settings)
 *   #update-banner → UpdateBanner()
 *
 * InputBar y ChatContextBar viven dentro de ChatPage (no globales).
 */

// ── Estilos (orden del cascade = orden de estos imports) ──
// Antes estaban como <link> en index.html, pero los paths relativos a
// packages/xi-ui escapan del root de Vite y caen al SPA fallback en
// dev (Vite devuelve index.html en vez del CSS). Importarlos desde acá
// vía el alias 'xi-ui' los sirve correcto en dev y build, y preserva el
// orden del cascade (los <link> del HTML y los imports de JS se inyectan
// en puntos distintos del <head>; juntar todo acá lo hace determinista).
import 'xi-ui/styles/theme.css';
import 'xi-ui/styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import 'xi-ui/styles/components.css';
import './styles/pages.css';
import 'xi-ui/styles/markdown.css';

import '@fontsource/adwaita-sans/index.css';
import '@fontsource/adwaita-mono/400.css';
import '@fontsource/adwaita-mono/700.css';
import './styles/temml.css';
import 'katex/dist/katex.min.css';

import { appState } from 'xi-ui/lib/state.ts';
import { navigate } from 'xi-ui/lib/nav.ts';
import { initPiConnection, getPiStatus, getRecents } from './lib/pi/index.ts';
import { Header } from './components/Header.tsx';
import { OutputBoard } from './components/OutputBoard.tsx';
import { render } from 'solid-js/web';
import { UpdateBanner } from './components/UpdateBanner.tsx';
import { registerPaneType } from './components/PaneView.tsx';
import { ChatPage } from './pages/ChatPage.tsx';
import { ExplorerPane } from './pages/ExplorerPane.tsx';
import { SessionsPane } from './pages/SessionsPane.tsx';
import { addEntry } from 'xi-ui/lib/debug-panel.ts';
import { loadTheme, loadFontSize, applyThemeToDOM, applyFontToDOM } from './lib/settings-storage.ts';
import { getAvailableModels, getPiUpstreamVersion } from 'xi-ui/lib/pi/tauri-commands.ts';
import { checkForUpdate, isUpdaterAvailable } from './lib/updater.ts';

async function main(): Promise<void> {
  addEntry('system', 'xi starting...');

  const initialTheme = loadTheme();
  const initialFont = loadFontSize();
  applyThemeToDOM(initialTheme);
  applyFontToDOM(initialFont);
  appState.theme.value = initialTheme;
  appState.fontSize.value = initialFont;
  addEntry('system', `theme=${initialTheme} fontSize=${initialFont}`);

  try {
    await initPiConnection();
    addEntry('system', 'pi connection initialized');
  } catch (err) {
    addEntry('system', `Pi connection failed: ${err}`);
    throw err;
  }

  await initDesktop();

  mountShell();

  if (appState.workingDir.value) {
    // Crear una tab con SessionsPicker al abrir proyecto
    // (import dinámico para evitar circular deps en entry point)
    const m = await import('./lib/panel-manager.ts');
    if (m.getTabs().length === 0) {
      m.openSessionTab();
    }
  }
  // Si no hay workingDir, welcome page se muestra por defecto
}

async function initDesktop(): Promise<void> {
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

  try {
    appState.recents.value = await getRecents();
    addEntry('system', `loaded ${appState.recents.value.length} recents`);
  } catch (err) {
    addEntry('system', `Could not load recents: ${err}`);
  }

  if (hasWorkingDir) {
    getAvailableModels();
    addEntry('system', 'requested available models');
  }

  setTimeout(() => {
    if (isUpdaterAvailable()) void checkForUpdate();
    void getPiUpstreamVersion();
  }, 2500);
}

function mountShell(): void {
  // Registrar tipos de panel para el sistema de paneles
  registerPaneType('chat', ChatPage);
  registerPaneType('explorer', ExplorerPane);
  registerPaneType('sessions', SessionsPane);

  // Montar Header con SolidJS
  render(() => <Header />, document.getElementById('top-bar')!);
  // Montar UpdateBanner con SolidJS — reemplaza el contenido de #update-banner
  render(() => <UpdateBanner />, document.getElementById('update-banner')!);
  // Montar OutputBoard con SolidJS — contiene el routing de páginas
  render(() => <OutputBoard />, document.getElementById('output-board')!);
}

const w = window as unknown as Record<string, unknown>;
w.__XI_APP_STATE = appState;
w.__XI_NAVIGATE = navigate;

main();
