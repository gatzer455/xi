/**
 * index.js — Entry point del plugin xi-terminal.
 *
 * xi carga este archivo via import() dinámico y llama register(api).
 */

import { TerminalPane } from './TerminalPane.js';

let pluginWorkingDir = null;

export function register(api) {
  console.log('[xi-terminal] registrando pane type');
  pluginWorkingDir = api.workingDir;
  api.registerPaneType('terminal', TerminalPane, 'Terminal');
}

/** Directorio de trabajo actual, o null. Lo setea xi al cargar el plugin. */
export function getWorkingDir() { return pluginWorkingDir; }
