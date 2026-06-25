/**
 * index.ts — Fachada pública del paquete `pi/`.
 *
 * Este archivo no tiene lógica. Su trabajo es uno solo: concentrar las
 * re-exports para que los consumidores (main.ts, pages/chat.ts,
 * components/sidebar.ts) importen desde una sola ruta, y para que un
 * refactor interno de los 4 módulos no rompa esos imports.
 */

export {
  startPi,
  stopPi,
  sendPrompt,
  abortPi,
  getPiState,
  getPiMessages,
  newPiSession,
  getPiStatus,
  listSessions,
  deleteSession,
  renameSession,
  getRecents,
  addRecent,
} from './tauri-commands.ts';
export type { PiStatus } from './tauri-commands.ts';
export type { Recent, SessionInfo } from './types.ts';

export { initPiConnection, destroyPiConnection } from './init.ts';

export { parsePiEvent } from './event-parser.ts';
export type {
  PiEvent,
  PiEventType,
  PiResponseEvent,
  PiMessageUpdateEvent,
  PiToolExecutionEvent,
  PiAgentEvent,
  AssistantMessageEvent,
  AssistantMessageEventType,
} from './event-parser.ts';

export { applyEvent } from './state-sync.ts';

export { ensurePiRunning } from './lifecycle.ts';
