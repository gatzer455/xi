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
 *
 * En mobile, los comandos de pi stdin van por WebSocket (vía PiEventBus),
 * y los comandos Tauri (getPiStatus, listSessions, etc.) van por
 * PiEventBus.invoke() con nombres xi_* hacia xi-serve.
 */

import { invoke } from '@tauri-apps/api/core';
import { addEntry } from '../debug-panel.ts';
import type { ListSessionsResult, Recent, SessionInfo } from './types.ts';
import type { ThinkingLevel, FileEntry } from '../state.ts';

let commandBus: { sendCommand(json: string): Promise<void>;
  invoke<T>(method: string, params?: unknown): Promise<T>; } | null = null;
let isMobile = false;

export function setCommandBus(bus: { sendCommand(json: string): Promise<void>;
    invoke<T>(method: string, params?: unknown): Promise<T>; } | null, mobile = false): void {
  commandBus = bus;
  isMobile = mobile;
}

async function sendPiCommand(json: string): Promise<void> {
  if (commandBus) {
    await commandBus.sendCommand(json);
  } else {
    await invoke('send_pi_command', { json });
  }
}

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
  if (isMobile) {
    await commandBus!.invoke('xi_set_project', { path: cwd });
    return;
  }
  await loggedInvoke('start_pi', () => invoke('start_pi', { cwd, sessionPath: sessionPath ?? null }));
}

export async function stopPi(): Promise<void> {
  addEntry('out', 'stop_pi');
  await loggedInvoke('stop_pi', () => invoke('stop_pi'));
}

export async function sendPrompt(message: string): Promise<void> {
  const cmd = JSON.stringify({ type: 'prompt', message });
  addEntry('out', cmd);
  await loggedInvoke('sendPrompt', () => sendPiCommand(cmd));
}

export async function abortPi(): Promise<void> {
  const cmd = JSON.stringify({ type: 'abort' });
  addEntry('out', cmd);
  await loggedInvoke('abortPi', () => sendPiCommand(cmd));
}

export async function getPiState(): Promise<void> {
  const cmd = JSON.stringify({ type: 'get_state' });
  addEntry('out', cmd);
  await loggedInvoke('getPiState', () => sendPiCommand(cmd));
}

export async function getPiMessages(): Promise<void> {
  const cmd = JSON.stringify({ type: 'get_messages' });
  addEntry('out', cmd);
  await loggedInvoke('getPiMessages', () => sendPiCommand(cmd));
}

export async function newPiSession(): Promise<void> {
  const cmd = JSON.stringify({ type: 'new_session' });
  addEntry('out', cmd);
  await loggedInvoke('newPiSession', () => sendPiCommand(cmd));
}

export interface PiStatus {
  running: boolean;
  cwd: string | null;
}

export async function getPiStatus(): Promise<PiStatus> {
  addEntry('out', 'get_pi_status');
  if (isMobile) {
    return commandBus!.invoke('xi_get_status') as Promise<PiStatus>;
  }
  return await loggedInvoke('get_pi_status', () => invoke('get_pi_status'));
}

export async function listSessions(cwd: string): Promise<ListSessionsResult> {
  addEntry('out', `list_sessions cwd=${cwd}`);
  if (isMobile) {
    return commandBus!.invoke('xi_list_sessions', { cwd }) as Promise<ListSessionsResult>;
  }
  return await loggedInvoke('list_sessions', () => invoke('list_sessions', { cwd }));
}

export async function deleteSession(path: string): Promise<void> {
  addEntry('out', `delete_session path=${path}`);
  if (isMobile) {
    // xi-serve no tiene delete_session aún, skip
    return;
  }
  await loggedInvoke('delete_session', () => invoke('delete_session', { path }));
}

/** Solo mobile: proyectos de la whitelist de xi-serve. */
export async function listProjects(): Promise<string[]> {
  addEntry('out', 'xi_list_projects');
  if (!isMobile) return [];
  const r = await commandBus!.invoke('xi_list_projects') as { projects: string[] };
  return r.projects;
}

/** Solo mobile: abre una sesión existente (kill + respawn de pi con --session). */
export async function openSession(path: string): Promise<void> {
  addEntry('out', `xi_open_session path=${path}`);
  if (!isMobile) return;
  await commandBus!.invoke('xi_open_session', { path });
}

export async function renameSession(path: string, name: string): Promise<void> {
  addEntry('out', `rename_session path=${path} name=${name}`);
  if (isMobile) {
    return;
  }
  await loggedInvoke('rename_session', () => invoke('rename_session', { path, name }));
}

export async function getRecents(): Promise<Recent[]> {
  addEntry('out', 'get_recents');
  if (isMobile) {
    return [];
  }
  return await loggedInvoke('get_recents', () => invoke('get_recents'));
}

export async function addRecent(path: string): Promise<void> {
  addEntry('out', `add_recent path=${path}`);
  if (isMobile) return;
  await loggedInvoke('add_recent', () => invoke('add_recent', { path }));
}

export async function setModel(provider: string, modelId: string): Promise<void> {
  const cmd = JSON.stringify({ type: 'set_model', provider, modelId });
  addEntry('out', cmd);
  await loggedInvoke('setModel', () => sendPiCommand(cmd));
}

export async function setThinkingLevel(level: ThinkingLevel): Promise<void> {
  const cmd = JSON.stringify({ type: 'set_thinking_level', level });
  addEntry('out', cmd);
  await loggedInvoke('setThinkingLevel', () => sendPiCommand(cmd));
}

export function getAvailableModels(): void {
  const cmd = JSON.stringify({ type: 'get_available_models' });
  addEntry('out', cmd);
  sendPiCommand(cmd).catch(err => {
    addEntry('system', `[getAvailableModels] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  });
}

export async function getPiVersion(): Promise<string> {
  addEntry('out', 'get_pi_version');
  if (isMobile) {
    const r = await commandBus!.invoke('xi_get_pi_version') as { version: string };
    return r.version;
  }
  return await loggedInvoke('get_pi_version', () => invoke('get_pi_version'));
}

export async function getPiUpstreamVersion(): Promise<string | null> {
  addEntry('out', 'get_pi_upstream_version');
  if (isMobile) return null;
  return await loggedInvoke('get_pi_upstream_version', () => invoke('get_pi_upstream_version'));
}

export interface ProviderInfo {
  id: string;
  hasKey: boolean;
  last4: string | null;
}

export async function getAuthStatus(): Promise<ProviderInfo[]> {
  addEntry('out', 'get_auth_status');
  if (isMobile) {
    return commandBus!.invoke('xi_get_auth_status') as Promise<ProviderInfo[]>;
  }
  return await loggedInvoke('get_auth_status', () => invoke('get_auth_status'));
}

export async function getApiKey(provider: string): Promise<string | null> {
  addEntry('out', `get_api_key provider=${provider}`);
  if (isMobile) return null;
  return await loggedInvoke('get_api_key', () => invoke('get_api_key', { provider }));
}

export async function setApiKey(provider: string, apiKey: string): Promise<void> {
  addEntry('out', `set_api_key provider=${provider}`);
  if (isMobile) return;
  await loggedInvoke('set_api_key', () => invoke('set_api_key', { provider, apiKey }));
}

export async function testApiKey(provider: string, apiKey: string): Promise<string> {
  addEntry('out', `test_api_key provider=${provider}`);
  if (isMobile) return '';
  return await loggedInvoke('test_api_key', () => invoke('test_api_key', { provider, apiKey }));
}

export async function deleteApiKey(provider: string): Promise<void> {
  addEntry('out', `delete_api_key provider=${provider}`);
  if (isMobile) return;
  await loggedInvoke('delete_api_key', () => invoke('delete_api_key', { provider }));
}

export async function listFiles(path: string): Promise<FileEntry[]> {
  addEntry('out', `list_files path=${path}`);
  if (isMobile) {
    return commandBus!.invoke('xi_list_files', { path }) as Promise<FileEntry[]>;
  }
  return await loggedInvoke('list_files', () => invoke('list_files', { path }));
}

export async function readFile(path: string): Promise<string> {
  addEntry('out', `read_file path=${path}`);
  if (isMobile) {
    return commandBus!.invoke('xi_read_file', { path }) as Promise<string>;
  }
  return await loggedInvoke('read_file', () => invoke('read_file', { path }));
}

export async function writeFile(path: string, content: string): Promise<void> {
  addEntry('out', `write_file path=${path}`);
  if (isMobile) return;
  await loggedInvoke('write_file', () => invoke('write_file', { path, content }));
}

export interface ExaConfigStatus {
  hasKey: boolean;
  last4: string | null;
}

export async function getExaConfig(): Promise<ExaConfigStatus> {
  addEntry('out', 'get_exa_config');
  if (isMobile) return { hasKey: true, last4: null };
  return await loggedInvoke('get_exa_config', () => invoke('get_exa_config'));
}

export async function getExaApiKey(): Promise<string | null> {
  addEntry('out', 'get_exa_api_key');
  if (isMobile) return null;
  return await loggedInvoke('get_exa_api_key', () => invoke('get_exa_api_key'));
}

export async function setExaApiKey(apiKey: string): Promise<void> {
  addEntry('out', `set_exa_api_key`);
  if (isMobile) return;
  await loggedInvoke('set_exa_api_key', () => invoke('set_exa_api_key', { apiKey }));
}

export async function deleteExaApiKey(): Promise<void> {
  addEntry('out', 'delete_exa_api_key');
  if (isMobile) return;
  await loggedInvoke('delete_exa_api_key', () => invoke('delete_exa_api_key'));
}

export async function testExaApiKey(apiKey: string): Promise<string> {
  addEntry('out', 'test_exa_api_key');
  if (isMobile) return '';
  return await loggedInvoke('test_exa_api_key', () => invoke('test_exa_api_key', { apiKey }));
}

export interface ApproveRules {
  rules: Record<string, string[]>;
  messages: Record<string, string>;
}

export async function getApproveRules(): Promise<ApproveRules> {
  if (isMobile) return { rules: {}, messages: {} };
  return await loggedInvoke('getApproveRules', () => invoke('get_approve_rules'));
}

export async function setApproveRules(config: ApproveRules): Promise<void> {
  if (isMobile) return;
  await loggedInvoke('setApproveRules', () => invoke('set_approve_rules', { config }));
}
