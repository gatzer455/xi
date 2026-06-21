/**
 * types.ts — Tipos compartidos del paquete `pi/`.
 *
 * Módulo puro: no importa nada de Tauri, de `appState`, ni de otros
 * módulos de `lib/pi/`. Solo define tipos que cruzan la frontera
 * Rust ↔ TypeScript.
 *
 * Refleja el struct `SessionInfo` de `backend/src/commands/pi_sessions.rs`.
 * Si cambian los campos en un lado, hay que actualizarlos en el otro —
 * el contrato se valida en el `serde_json::from_str` de Rust.
 */

export interface SessionInfo {
  path: string;
  id: string;
  /** Working directory donde la sesión fue creada. */
  cwd: string;
  /** Nombre custom del último entry `session_info`, si existe. */
  name?: string;
  /** Path al JSONL del parent (si esta sesión fue forked). */
  parentSessionPath?: string;
  /** Unix ms. */
  created: number;
  /** Unix ms. */
  modified: number;
  messageCount: number;
  firstMessage: string;
}

/** Archivos corruptos que pi-sessions no pudo leer. */
export interface SkippedInfo {
  count: number;
}

/** Resultado de list_sessions: sesiones + opcionalmente archivos saltados. */
export interface ListSessionsResult {
  sessions: SessionInfo[];
  skipped?: SkippedInfo;
}

/**
 * Proyecto reciente. Persistido en `app_config_dir/recents.json`
 * (vía `get_recents` / `add_recent` en Rust). El frontend lo lee una
 * vez al iniciar y lo usa para popular la pantalla `#/welcome`.
 */
export interface Recent {
  path: string;
  /** Unix ms. */
  lastOpened: number;
  /** Basename del path al momento de agregar. */
  name: string;
}

// ─── Extension UI Protocol ───────────────────────────────────────────────────
//
// Protocolo para requests interactivos de extensiones de pi.
// pi emite `extension_ui_request` por stdout, xi intercepta,
// muestra UI, y responde con `extension_ui_response` por stdin.
//
// Referencia: ~/.nvm/.../pi-coding-agent/docs/rpc.md#extension-ui-protocol

export interface ExtensionUIRequestBase {
  type: 'extension_ui_request';
  id: string;
  timeout?: number;
}

export interface ExtensionUISelectRequest extends ExtensionUIRequestBase {
  method: 'select';
  title: string;
  options: string[];
}

export interface ExtensionUIConfirmRequest extends ExtensionUIRequestBase {
  method: 'confirm';
  title: string;
  message: string;
}

export interface ExtensionUIInputRequest extends ExtensionUIRequestBase {
  method: 'input';
  title: string;
  placeholder?: string;
}

export interface ExtensionUIEditorRequest extends ExtensionUIRequestBase {
  method: 'editor';
  title: string;
  prefill?: string;
}

export interface ExtensionUINotifyRequest extends ExtensionUIRequestBase {
  method: 'notify';
  message: string;
  notifyType?: 'info' | 'warning' | 'error';
}

export type ExtensionUIRequest =
  | ExtensionUISelectRequest
  | ExtensionUIConfirmRequest
  | ExtensionUIInputRequest
  | ExtensionUIEditorRequest
  | ExtensionUINotifyRequest;
