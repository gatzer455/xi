/**
 * debug-panel.ts — Logger de eventos de pi para consola F12 + terminal.
 *
 * Envía logs estructurados a dos destinos simultáneamente:
 * - F12: via console.log (WebView)
 * - Terminal: via tauri-plugin-log (Rust stdout + archivo)
 *
 * En producción (build) es no-op.
 */

import { info, warn } from '@tauri-apps/plugin-log';

type Direction = 'in' | 'out' | 'system';

const MAX_ENTRIES = 500;
let entries: { timestamp: number; direction: Direction; message: string }[] = [];

export function addEntry(direction: Direction, message: string): void {
  // No-op en production
  if (!import.meta.env.DEV) return;

  const entry = {
    timestamp: Date.now(),
    direction,
    message: message.length > 2000 ? message.slice(0, 2000) + '… [truncated]' : message,
  };

  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(-MAX_ENTRIES);
  }

  // Formatear el mensaje con prefijo [xi:pi]
  const prefix = direction === 'in' ? '←' : direction === 'out' ? '→' : '⚠';
  const text = direction === 'system' && message.startsWith('[')
    ? `[xi:pi] ${message}`
    : `[xi:pi] [${prefix}] ${message}`;

  // F12
  console.log(text);

  // Terminal (via tauri-plugin-log → stdout + archivo)
  // Fire-and-forget: no await porque es logging, no crítico
  if (direction === 'system') {
    warn(text);
  } else {
    info(text);
  }
}