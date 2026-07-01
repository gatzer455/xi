/**
 * debug-panel.ts — Logger de eventos de pi para consola F12 + terminal.
 *
 * Envía logs estructurados a dos destinos simultáneamente:
 * - F12: via console.log (WebView)
 * - Terminal: via tauri-plugin-log (Rust stdout + archivo)
 *
 * En producción (build) es no-op.
 */

import { info, warn, error as logError } from '@tauri-apps/plugin-log';

type Direction = 'in' | 'out' | 'system';
type LogLevel = 'info' | 'warn' | 'error';

const MAX_ENTRIES = 500;
let entries: { timestamp: number; direction: Direction; message: string }[] = [];

export function addEntry(direction: Direction, message: string, level?: LogLevel): void {
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

  // Determinar nivel si no se especificó
  const effectiveLevel: LogLevel = level ?? inferLevel(direction, message);

  // F12
  console.log(text);

  // Terminal (via tauri-plugin-log → stdout + archivo)
  // Fire-and-forget: no await porque es logging, no crítico
  switch (effectiveLevel) {
    case 'error':
      logError(text);
      break;
    case 'warn':
      warn(text);
      break;
    default:
      info(text);
  }
}

/** Infiere el nivel de log según dirección y contenido del mensaje. */
function inferLevel(direction: Direction, message: string): LogLevel {
  if (direction === 'system') {
    const lower = message.toLowerCase();
    if (lower.includes('error') || lower.includes('fail') || lower.includes('exception')) {
      return 'error';
    }
    if (lower.includes('warn') || lower.includes('timeout') || lower.includes('unknown')) {
      return 'warn';
    }
    return 'info';
  }
  return 'info';
}