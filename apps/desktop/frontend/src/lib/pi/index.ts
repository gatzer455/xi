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
  getAvailableModels,
} from 'xi-ui/lib/pi/tauri-commands.ts';
export type { PiStatus } from 'xi-ui/lib/pi/tauri-commands.ts';
export type { Recent, SessionInfo } from 'xi-ui/lib/pi/types.ts';

export { initPiConnection, destroyPiConnection } from './init.ts';
export type { PiEventBus } from 'xi-ui/lib/pi/transport.ts';
export { TauriEventBus } from './tauri-event-bus.ts';

export { parsePiEvent } from 'xi-ui/lib/pi/event-parser.ts';
export type {
  PiEvent,
  PiEventType,
  PiResponseEvent,
  PiMessageUpdateEvent,
  PiMessageStartEvent,
  PiMessageEndEvent,
  PiToolExecutionEvent,
  PiAgentEvent,
  AssistantMessageEvent,
  AssistantMessageEventType,
} from 'xi-ui/lib/pi/event-parser.ts';

export { applyEvent, beginStreamForSession, endStream } from 'xi-ui/lib/pi/state-sync.ts';

export { dispatchSlashCommand, requestExtensionCommands } from 'xi-ui/lib/pi/slash-commands.ts';
export type { SlashOutcome } from 'xi-ui/lib/pi/slash-commands.ts';

export { ensurePiRunning } from './lifecycle.ts';
