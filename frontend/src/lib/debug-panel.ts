/**
 * debug-panel.ts — Logger de eventos de pi para la consola del WebView (F12).
 *
 * Antes era un panel visual dentro de la app (Ctrl+`). Ahora es solo un
 * logger ligero que escribe a console.log/error para que se vea en F12.
 *
 * En producción (build) es no-op.
 */

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

  const prefix = direction === 'in' ? '←' : direction === 'out' ? '→' : '⚠';
  if (direction === 'system' && message.startsWith('[')) {
    console.log(`[xi:pi] ${message}`);
  } else {
    console.log(`[xi:pi] [${prefix}]`, message);
  }
}