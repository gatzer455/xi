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
import type { ThinkingLevel } from '../state.ts';

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

// ───────────────────────────────────────────────────────
// Settings (Etapa 6: settings-real)
// ───────────────────────────────────────────────────────

/**
 * Pide a pi la lista de modelos disponibles. La respuesta llega via
 * eventos al state-sync (caso `get_available_models` en handleResponse),
 * que popula `appState.availableModels`. Este wrapper solo manda el
 * comando — NO espera la respuesta. La signal es la fuente de verdad
 * para el dropdown de settings.
 *
 * Si pi no está corriendo, el comando se manda igual pero no llega
 * respuesta: la signal queda vacía. El dropdown muestra el estado de
 * "loading" indefinidamente (mejor que mostrar error si el problema
 * es transitorio, según R20 del design).
 */
export function getAvailableModels(): void {
  const cmd = JSON.stringify({ type: 'get_available_models' });
  addEntry('out', cmd);
  void invoke('send_pi_command', { json: cmd }).catch(err => {
    addEntry('system', `[getAvailableModels] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  });
}

/**
 * Cambia el modelo de pi. Pi responde con un `response` que el
 * state-sync procesa (caso `set_model`), actualizando
 * appState.currentModel automáticamente.
 */
export async function setModel(provider: string, modelId: string): Promise<void> {
  const cmd = JSON.stringify({ type: 'set_model', provider, modelId });
  addEntry('out', cmd);
  await loggedInvoke('setModel', () => invoke('send_pi_command', { json: cmd }));
}

/**
 * Cambia el nivel de thinking. Acepta ThinkingLevel (tipo discriminado)
 * en vez de string suelto: TypeScript rechaza typos en compilación.
 */
export async function setThinkingLevel(level: ThinkingLevel): Promise<void> {
  const cmd = JSON.stringify({ type: 'set_thinking_level', level });
  addEntry('out', cmd);
  await loggedInvoke('setThinkingLevel', () => invoke('send_pi_command', { json: cmd }));
}

/**
 * Retorna la versión del sidecar pi (ej: '0.79.8'). Si el sidecar
 * no responde, retorna 'unknown' (no throw). El user ve "pi
 * desconocida" en settings; el dev ve el error en el debug panel.
 */
export async function getPiVersion(): Promise<string> {
  try {
    return await invoke<string>('get_pi_version');
  } catch (err) {
    addEntry('system', `getPiVersion failed: ${err instanceof Error ? err.message : String(err)}`);
    return 'unknown';
  }
}

/**
 * Retorna la última versión de pi upstream desde pi.dev. Si el
 * endpoint falla, retorna null. Usado internamente para el debug
 * panel; el user nunca ve este valor.
 */
export async function getPiUpstreamVersion(): Promise<string | null> {
  try {
    const version = await invoke<string>('get_pi_upstream_version');
    addEntry('system', `pi upstream: ${version}`);
    return version;
  } catch (err) {
    addEntry('system', `getPiUpstreamVersion failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Lee ~/.pi/agent/auth.json y retorna la lista de providers con
 * su info pública (id, has_key, last4). Empty array si no hay auth
 * o si el archivo está corrupto. El wrapper NO lanza — siempre
 * retorna un array.
 *
 * La key completa NUNCA viaja en este command. Solo se envía via
 * getApiKey() cuando el user hace click en "Ver" en la UI.
 */
export interface ProviderInfo {
  id: string;
  hasKey: boolean;
  last4: string | null;
}

export async function getAuthStatus(): Promise<ProviderInfo[]> {
  try {
    const result = await invoke<ProviderInfo[]>('get_auth_status');
    addEntry('system', `getAuthStatus: ${result.length} providers [${result.map(p => p.id).join(', ')}]`);
    return result;
  } catch (err) {
    addEntry('system', `getAuthStatus failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Retorna la key completa de un provider. SOLO se invoca cuando el
 * user hace click en "Ver" en la UI. La key viaja del backend al
 * frontend por IPC local de Tauri (no hay red). El caller debe
 * mostrarla y luego limpiarla (no persistir en state).
 *
 * Retorna null si el provider no existe o es oauth.
 */
export async function getApiKey(provider: string): Promise<string | null> {
  addEntry('out', `get_api_key: ${provider}`);
  try {
    const result = await invoke<string | null>('get_api_key', { provider });
    return result;
  } catch (err) {
    addEntry('system', `getApiKey failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Escribe (o actualiza) la API key de un provider en
 * ~/.pi/agent/auth.json. Atomic write, chmod 600. Si falla, throw
 * — el caller (form de settings) muestra el error al user.
 */
export async function setApiKey(provider: string, apiKey: string): Promise<void> {
  addEntry('out', `set_api_key: ${provider}`);
  await loggedInvoke('setApiKey', () =>
    invoke('set_api_key', { provider, apiKey }),
  );
}

/**
 * Hace un ping al provider para validar que la key funciona.
 * Retorna el mensaje de error (string vacío = ok). El wrapper
 * NO lanza — el comando Rust siempre retorna Ok(()) o Err(msg),
 * y acá lo manejamos devolviendo el string directamente para
 * que el caller no necesite try/catch.
 */
export async function testApiKey(provider: string, apiKey: string): Promise<string> {
  addEntry('out', `test_api_key: ${provider}`);
  try {
    await invoke('test_api_key', { provider, apiKey });
    return '';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addEntry('system', `test_api_key ${provider} failed: ${message}`);
    return message;
  }
}

/**
 * Elimina la key de un provider de ~/.pi/agent/auth.json.
 * Idempotente: si el provider no existe, no es error. Throw on
 * cualquier otro error (permisos, archivo corrupto, etc).
 */
export async function deleteApiKey(provider: string): Promise<void> {
  addEntry('out', `delete_api_key: ${provider}`);
  await loggedInvoke('deleteApiKey', () => invoke('delete_api_key', { provider }));
}
