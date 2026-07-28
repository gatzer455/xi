/**
 * TerminalPane.js — Componente de terminal con xterm.js.
 *
 * Se comunica con el sidecar xi-terminal via stdin/stdout JSONL.
 * El sidecar se spawnea desde el backend de xi (Tauri command).
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import xtermCss from '@xterm/xterm/css/xterm.css?inline';

// CSS se inyecta dinámicamente
const TERM_CSS = `
  .terminal-pane { width: 100%; height: 100%; overflow: hidden; }
  .terminal-pane .xterm { height: 100%; padding: 0.5rem; }
` + xtermCss;

let cssInjected = false;

export function TerminalPane() {
  // Inyectar CSS una sola vez
  if (!cssInjected) {
    const style = document.createElement('style');
    style.textContent = TERM_CSS + (import.meta.env?.VITE_XTERM_CSS || '');
    document.head.appendChild(style);
    cssInjected = true;
  }

  const container = document.createElement('div');
  container.className = 'terminal-pane';

  // Setup diferido: xterm.js necesita el DOM montado para medir
  setTimeout(() => setupTerminal(container), 50);

  return container;
}

async function setupTerminal(container) {
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'Fira Mono', 'JetBrains Mono', monospace",
    theme: {
      background: getComputedStyle(document.documentElement).getPropertyValue('--color-page-bg').trim() || '#0a0632',
      foreground: getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim() || '#c5aaec',
      cursor: getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#6716dd',
    },
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  fitAddon.fit();

  // TODO: spawn sidecar via Tauri command, pipe data
  term.writeln('\x1b[1;35m▸ xi-terminal\x1b[0m — listo.');

  // Resize on container change
  const observer = new ResizeObserver(() => fitAddon.fit());
  observer.observe(container);

  // Cleanup on dispose
  container._xiTerm = { term, fitAddon, observer, dispose: () => {
    observer.disconnect();
    term.dispose();
  }};
}
