/**
 * debug-panel.ts — Logger de eventos de pi para consola F12 + terminal + archivo.
 *
 * Envía logs estructurados a tres destinos:
 * - F12: via console.log (WebView) — solo en dev
 * - Terminal: via tauri-plugin-log (Rust stdout)
 * - Archivo: via tauri-plugin-log (xi.log)
 *
 * En producción (build) el console.log se omite, pero los logs
 * siguen yendo a stdout + archivo vía el plugin.
 */

import { info, debug, warn, error as logError } from '@tauri-apps/plugin-log';

type Direction = 'in' | 'out' | 'system';
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const MAX_ENTRIES = 500;
let entries: { timestamp: number; direction: Direction; message: string }[] = [];

export function addEntry(direction: Direction, message: string, level?: LogLevel): void {
  // Truncar mensajes muy largos para evitar saturar
  const truncated = message.length > 2000 ? message.slice(0, 2000) + '… [truncated]' : message;

  const entry = { timestamp: Date.now(), direction, message: truncated };

  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(-MAX_ENTRIES);
  }

  // Formatear el mensaje con prefijo [xi:pi] usando el texto ya truncado
  const prefix = direction === 'in' ? '←' : direction === 'out' ? '→' : '⚠';
  const text = direction === 'system' && truncated.startsWith('[')
    ? `[xi:pi] ${truncated}`
    : `[xi:pi] [${prefix}] ${truncated}`;

  // F12 — solo en dev
  if (import.meta.env.DEV) {
    console.log(text);
  }

  // Terminal + archivo (via tauri-plugin-log) — en todos los builds
  const effectiveLevel: LogLevel = level ?? inferLevel(direction, truncated);
  switch (effectiveLevel) {
    case 'error':
      logError(text);
      break;
    case 'warn':
      warn(text);
      break;
    case 'debug':
      debug(text);
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