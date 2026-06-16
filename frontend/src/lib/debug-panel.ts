/**
 * debug-panel.ts — Panel de debug para ver logs de pi
 *
 * Se activa con Ctrl+` o haciendo click en el indicador de estado.
 * Muestra todos los eventos raw que llegan de pi para diagnóstico.
 */

import { appState } from './state.ts';
import { listen } from '@tauri-apps/api/event';

interface LogEntry {
  timestamp: number;
  direction: 'in' | 'out' | 'system';
  message: string;
}

let isOpen = false;
let entries: LogEntry[] = [];
let unlisten: (() => void) | null = null;
let panelEl: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let statusDot: HTMLElement | null = null;

const MAX_ENTRIES = 500;

export function initDebugPanel(): HTMLElement {
  // ═══ Status dot (always visible) ═══
  statusDot = document.createElement('button');
  statusDot.className = 'debug-status';
  statusDot.style.cssText = 'position: fixed; bottom: 12px; right: 12px; z-index: 10000; background: transparent; border: none; color: #4ade80; font-size: 14px; cursor: pointer; padding: 4px 8px;';
  statusDot.innerHTML = '●';
  statusDot.title = 'Click para ver logs (Ctrl+`)';
  statusDot.addEventListener('click', togglePanel);

  // Keyboard shortcut
  document.addEventListener('keydown', (e) => {
    if (e.key === '`' && e.ctrlKey) {
      e.preventDefault();
      togglePanel();
    }
  });

  // ═══ Panel ═══
  panelEl = document.createElement('div');
  panelEl.className = 'debug-panel';
  panelEl.style.cssText = `
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 300px;
    background: var(--color-surface, #1a1a1a);
    color: var(--color-text, #e0e0e0);
    border-top: 1px solid var(--color-border, #333);
    font-family: ui-monospace, 'SF Mono', monospace;
    font-size: 12px;
    display: none;
    flex-direction: column;
    z-index: 9999;
  `;

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border, #333);
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;

  const title = document.createElement('span');
  title.textContent = '🔍 Debug — eventos de pi';
  header.append(title);

  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 8px;';

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Limpiar';
  clearBtn.style.cssText = 'background: transparent; border: 1px solid #555; color: #aaa; padding: 2px 8px; border-radius: 4px; cursor: pointer;';
  clearBtn.addEventListener('click', () => {
    entries = [];
    renderEntries();
  });
  actions.append(clearBtn);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background: transparent; border: none; color: #aaa; cursor: pointer; font-size: 16px;';
  closeBtn.addEventListener('click', togglePanel);
  actions.append(closeBtn);

  header.append(actions);
  panelEl.append(header);

  // List
  listEl = document.createElement('div');
  listEl.style.cssText = `
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
  `;
  panelEl.append(listEl);

  // Container que contiene dot y panel
  const container = document.createElement('div');
  container.id = 'debug-container';
  container.append(statusDot);
  container.append(panelEl);
  return container;
}

async function togglePanel(): Promise<void> {
  isOpen = !isOpen;
  if (panelEl) {
    panelEl.style.display = isOpen ? 'flex' : 'none';
  }

  // Re-renderizar al abrir: por si entries se populó antes de que
  // el panel existiera (main.ts loguea antes de montar el panel).
  if (isOpen) {
    renderEntries();
  }

  // Lazy-init listener propio: este es redundante con init.ts (que ya
  // registra un listen en main.ts). Lo dejamos como segundo punto de
  // observación por si init.ts se rompe; nunca reemplaza al de init.ts.
  if (isOpen && !unlisten) {
    const raw = await listen<string>('pi:raw', (event) => {
      console.log('[xi:debug] raw event (debug-panel listener):', event.payload);
    });
    const err = await listen<string>('pi:err', (event) => {
      console.log('[xi:debug] err event (debug-panel listener):', event.payload);
    });
    unlisten = () => { raw(); err(); };
  }
}

export function addEntry(direction: LogEntry['direction'], message: string): void {
  const entry: LogEntry = { timestamp: Date.now(), direction, message };

  // Truncar mensajes muy largos para el log visual
  if (entry.message.length > 2000) {
    entry.message = entry.message.slice(0, 2000) + '... [truncated]';
  }

  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(-MAX_ENTRIES);
  }

  // Loguear a la consola del WebView además del panel. Si el panel
  // falla en renderizar, los console siguen ahí para DevTools (F12).
  const prefix = direction === 'in' ? '←' : direction === 'out' ? '→' : '⚠';
  console.log(`[xi:debug] [${prefix}]`, message);

  if (isOpen) {
    renderEntries();
  }
}

function renderEntries(): void {
  if (!listEl) return;
  listEl.replaceChildren();

  for (const entry of entries.slice(-100)) {
    const row = document.createElement('div');
    row.style.cssText = `
      padding: 2px 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      word-break: break-all;
      white-space: pre-wrap;
    `;

    const time = document.createElement('span');
    time.style.cssText = 'color: #666; margin-right: 8px;';
    time.textContent = new Date(entry.timestamp).toLocaleTimeString();
    row.append(time);

    const arrow = document.createElement('span');
    arrow.style.cssText = `margin-right: 8px; color: ${
      entry.direction === 'in' ? '#4ade80' :
      entry.direction === 'out' ? '#60a5fa' : '#facc15'
    };`;
    arrow.textContent = entry.direction === 'in' ? '←' : entry.direction === 'out' ? '→' : '⚠';
    row.append(arrow);

    const msg = document.createElement('span');
    msg.textContent = entry.message;
    row.append(msg);

    listEl.append(row);
  }

  // Auto-scroll
  listEl.scrollTop = listEl.scrollHeight;
}
