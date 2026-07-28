/**
 * index.js — Entry point del plugin xi-terminal.
 *
 * xi carga este archivo via import() dinámico y llama register(api).
 */

import { TerminalPane } from './TerminalPane.js';

let getWorkingDirFn = null;

export function register(api) {
  console.log('[xi-terminal] registrando pane type');
  getWorkingDirFn = api.getWorkingDir;
  api.registerPaneType('terminal', TerminalPane, 'Terminal');
}

/** Directorio de trabajo actual, o null. Lo consulta en cada llamada. */
export function getWorkingDir() { return getWorkingDirFn ? getWorkingDirFn() : null; }
