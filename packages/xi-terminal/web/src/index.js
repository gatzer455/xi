/**
 * index.js — Entry point del plugin xi-terminal.
 *
 * xi carga este archivo via import() dinámico y llama register(api).
 */

import { TerminalPane } from './TerminalPane.js';

export function register(api) {
  console.log('[xi-terminal] registrando pane type');
  api.registerPaneType('terminal', TerminalPane);
}
