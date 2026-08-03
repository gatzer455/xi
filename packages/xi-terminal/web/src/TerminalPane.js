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
import { getWorkingDir } from './index.js';

const TERM_CSS = xtermCss + `
  .terminal-pane {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--color-terminal-bg, var(--color-page-bg));
  }
  .terminal-pane .xterm {
    height: 100%;
    padding: 0.75rem 1rem;
  }
  .terminal-pane .xterm-viewport {
    background: var(--color-terminal-bg, var(--color-page-bg)) !important;
  }
`;

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
  const css = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  const baseFontSize = Math.max(parseFloat(styles.fontSize) || 14, 14);
  const term = new Terminal({
    cursorBlink: true,
    fontSize: baseFontSize,
    lineHeight: 1.35,
    fontFamily: "'Fira Mono', 'JetBrains Mono', monospace",
    theme: {
      background: css('--color-terminal-bg', '#090717'),
      foreground: css('--color-terminal-fg', '#eee9f8'),
      cursor: css('--color-terminal-cursor', '#c5aaec'),
      cursorAccent: css('--color-terminal-bg', '#090717'),
      selectionBackground: css('--color-terminal-selection', '#3b315d'),
      black: css('--color-terminal-black', '#0d0a18'),
      red: css('--color-terminal-red', '#ff879b'),
      green: css('--color-terminal-green', '#83e59c'),
      yellow: css('--color-terminal-yellow', '#f4d175'),
      blue: css('--color-terminal-blue', '#91bcff'),
      magenta: css('--color-terminal-magenta', '#d8a8ff'),
      cyan: css('--color-terminal-cyan', '#81dce5'),
      white: css('--color-terminal-white', '#eee9f8'),
      brightBlack: css('--color-terminal-bright-black', '#777188'),
      brightRed: css('--color-terminal-bright-red', '#ffabb8'),
      brightGreen: css('--color-terminal-bright-green', '#b0f3bd'),
      brightYellow: css('--color-terminal-bright-yellow', '#ffe8a5'),
      brightBlue: css('--color-terminal-bright-blue', '#b8d3ff'),
      brightMagenta: css('--color-terminal-bright-magenta', '#ebd0ff'),
      brightCyan: css('--color-terminal-bright-cyan', '#b3f1f5'),
      brightWhite: css('--color-terminal-bright-white', '#ffffff'),
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
    const cwd = getWorkingDir();
    const spawnMsg = JSON.stringify({
      cmd: 'spawn',
      shell: null,
      cwd,
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
