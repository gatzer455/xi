/**
 * TerminalPane.js — Componente de terminal con xterm.js.
 *
 * Se comunica con el sidecar xi-terminal via Tauri commands
 * (spawn_plugin_pty, write_plugin_stdin) y escucha eventos
 * Tauri (plugin:terminal:data).
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import xtermCss from '@xterm/xterm/css/xterm.css?inline';

const TERM_CSS = `
  .terminal-pane { width: 100%; height: 100%; overflow: hidden; }
  .terminal-pane .xterm { height: 100%; padding: 0.5rem; }
` + xtermCss;

let cssInjected = false;
let termCount = 0;

export function TerminalPane() {
  if (!cssInjected) {
    const style = document.createElement('style');
    style.textContent = TERM_CSS;
    document.head.appendChild(style);
    cssInjected = true;
  }

  const container = document.createElement('div');
  container.className = 'terminal-pane';

  setTimeout(() => setupTerminal(container), 50);

  return container;
}

async function setupTerminal(container) {
  const { invoke } = window.__TAURI__?.core || {};
  if (!invoke) {
    container.textContent = 'Error: Tauri API no disponible';
    return;
  }

  const styles = getComputedStyle(document.documentElement);
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'Fira Mono', 'JetBrains Mono', monospace",
    theme: {
      background: styles.getPropertyValue('--color-page-bg').trim() || '#0a0632',
      foreground: styles.getPropertyValue('--color-text').trim() || '#c5aaec',
      cursor: styles.getPropertyValue('--color-accent').trim() || '#6716dd',
    },
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  fitAddon.fit();

  const id = ++termCount;
  term.writeln(`\x1b[1;35m▸ terminal #${id}\x1b[0m`);

  // Spawnear el sidecar
  try {
    await invoke('spawn_plugin_pty', { pluginName: 'terminal' });

    // Spawnear shell dentro del sidecar
    const spawnMsg = JSON.stringify({
      cmd: 'spawn',
      shell: null,
      cwd: null,
      cols: term.cols,
      rows: term.rows,
    }) + '\n';
    await invoke('write_plugin_stdin', { pluginName: 'terminal', data: spawnMsg });

    term.writeln('\x1b[32m✓ shell iniciado\x1b[0m');
  } catch (e) {
    term.writeln(`\x1b[31m✗ Error: ${e}\x1b[0m`);
    return;
  }

  // Escuchar eventos de datos del sidecar
  const { listen } = window.__TAURI__?.event || {};
  if (listen) {
    const unlisten = await listen('plugin:terminal:data', (event) => {
      try {
        const parsed = JSON.parse(event.payload);
        if (parsed.event === 'data') {
          term.write(parsed.data);
        } else if (parsed.event === 'exit') {
          term.writeln(`\r\n\x1b[33m[Proceso terminado, código ${parsed.code}]\x1b[0m`);
        } else if (parsed.event === 'error') {
          term.writeln(`\r\n\x1b[31m[Error: ${parsed.msg}]\x1b[0m`);
        }
      } catch {
        term.write(event.payload);
      }
    });

    container._xiUnlisten = unlisten;
  }

  // Enviar keystrokes al sidecar
  term.onData((data) => {
    const msg = JSON.stringify({ cmd: 'write', data }) + '\n';
    invoke('write_plugin_stdin', { pluginName: 'terminal', data: msg }).catch(() => {});
  });

  // Resize
  term.onResize(({ cols, rows }) => {
    const msg = JSON.stringify({ cmd: 'resize', cols, rows }) + '\n';
    invoke('write_plugin_stdin', { pluginName: 'terminal', data: msg }).catch(() => {});
  });

  // ResizeObserver para el contenedor
  const observer = new ResizeObserver(() => fitAddon.fit());
  observer.observe(container);

  container._xiTerm = { term, fitAddon, observer, dispose() {
    observer.disconnect();
    container._xiUnlisten?.();
    term.dispose();
  }};
}
