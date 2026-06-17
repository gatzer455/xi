/**
 * tauri-commands.ts — Comandos que xi envía hacia el sidecar de pi.
 *
 * Cada función de este módulo termina en `invoke(...)` de Tauri. Es un
 * wrapper delgado: arma el JSON correcto y lo manda. No lee ni muta el
 * state. Si una función necesita leer state, va en otro módulo.
 *
 * Cada función loguea con `addEntry('out', ...)` antes del invoke. El log
 * aparece en el panel de debug, que es la única forma de ver qué está
 * pasando entre la UI y el sidecar sin abrir la consola del WebView.
 *
 * Los errores de Tauri se propagan. El caller decide qué hacer. Silenciar
 * aquí haría imposible diagnosticar fallos del sidecar.
 */

import { invoke } from '@tauri-apps/api/core';
import { addEntry } from '../debug-panel.ts';
import type { Recent, SessionInfo } from './types.ts';

// Helper: envuelve invoke con logging de éxito y error. Si la llamada
// falla, loguea el error en el panel antes de propagar la excepción.
async function loggedInvoke<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    return result;
  } catch (err) {
    addEntry('system', `[${label}] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

export async function startPi(cwd: string, sessionPath?: string): Promise<void> {
  addEntry('out', `start_pi cwd=${cwd} sessionPath=${sessionPath ?? '<none>'}`);
  await loggedInvoke('start_pi', () => invoke('start_pi', { cwd, sessionPath: sessionPath ?? null }));
}

export async function stopPi(): Promise<void> {
  addEntry('out', 'stop_pi');
  await loggedInvoke('stop_pi', () => invoke('stop_pi'));
}

export async function sendPrompt(message: string): Promise<void> {
  const cmd = JSON.stringify({ type: 'prompt', message });
  addEntry('out', cmd);
  await loggedInvoke('sendPrompt', () => invoke('send_pi_command', { json: cmd }));
}

export async function abortPi(): Promise<void> {
  const cmd = JSON.stringify({ type: 'abort' });
  addEntry('out', cmd);
  await loggedInvoke('abortPi', () => invoke('send_pi_command', { json: cmd }));
}

export async function getPiState(): Promise<void> {
  const cmd = JSON.stringify({ type: 'get_state' });
  addEntry('out', cmd);
  await loggedInvoke('getPiState', () => invoke('send_pi_command', { json: cmd }));
}

export async function getPiMessages(): Promise<void> {
  const cmd = JSON.stringify({ type: 'get_messages' });
  addEntry('out', cmd);
  await loggedInvoke('getPiMessages', () => invoke('send_pi_command', { json: cmd }));
}

export async function newPiSession(): Promise<void> {
  const cmd = JSON.stringify({ type: 'new_session' });
  addEntry('out', cmd);
  await loggedInvoke('newPiSession', () => invoke('send_pi_command', { json: cmd }));
}

export interface PiStatus {
  running: boolean;
  cwd: string | null;
}

export async function getPiStatus(): Promise<PiStatus> {
  return await loggedInvoke('getPiStatus', () => invoke<PiStatus>('get_pi_status'));
}

// ───────────────────────────────────────────────────────
// Gestión de sesiones (Etapa 4)
// ───────────────────────────────────────────────────────

/** Lista las sesiones del directorio de trabajo. */
export async function listSessions(cwd: string): Promise<SessionInfo[]> {
  addEntry('out', `list_sessions cwd=${cwd}`);
  return await loggedInvoke('list_sessions', () =>
    invoke<SessionInfo[]>('list_sessions', { cwd }),
  );
}

/** Borra el JSONL de una sesión. El path ya viene absoluto de SessionInfo. */
export async function deleteSession(path: string): Promise<void> {
  addEntry('out', `delete_session path=${path}`);
  await loggedInvoke('delete_session', () => invoke('delete_session', { path }));
}

/** Renombra una sesión agregando un entry `session_info` al JSONL. */
export async function renameSession(path: string, name: string): Promise<void> {
  addEntry('out', `rename_session path=${path} name=${name}`);
  await loggedInvoke('rename_session', () =>
    invoke('rename_session', { path, name }),
  );
}

// ───────────────────────────────────────────────────────
// Proyectos recientes (Etapa 5: welcome-and-recents)
// ───────────────────────────────────────────────────────

/**
 * Retorna la lista de proyectos recientes persistidos en
 * `app_config_dir/recents.json`. Retorna `[]` si el archivo no existe
 * o está corrupto (Rust loguea el warning).
 */
export async function getRecents(): Promise<Recent[]> {
  return await loggedInvoke('get_recents', () => invoke<Recent[]>('get_recents'));
}

/**
 * Agrega (o mueve al tope) un path en la lista de recientes. El path
 * se canoniza en Rust. Si no existe, falla. Solo llamar DESPUÉS de que
 * el proyecto se abrió OK — un path que pi rechaza no es un reciente
 * válido (decisión D4 del design).
 */
export async function addRecent(path: string): Promise<void> {
  addEntry('out', `add_recent path=${path}`);
  await loggedInvoke('add_recent', () => invoke('add_recent', { path }));
}
