/**
 * transport.ts — Interfaz PiEventBus para el stream de eventos de pi.
 *
 * Abstrae cómo llegan los eventos de pi y cómo se envían comandos.
 * Dos implementaciones:
 *   - TauriEventBus: IPC local (desktop actual)
 *   - WsEventBus:     WebSocket hacia xi-serve (mobile, futuro)
 *
 * El resto del pipeline (state-sync, smooth-streamer, chat) es
 * agnóstico del transporte — solo necesita un PiEventBus.
 */

import type { addEntry } from '../debug-panel.ts';
import type { PiEvent } from './event-parser.ts';

/**
 * Bus de eventos entre el frontend y pi.
 *
 * - sendCommand: envía un JSON al stdin de pi.
 * - setEventHandler: registra el handler que recibe cada línea de stdout.
 *   Solo un handler a la vez (el último set reemplaza al anterior).
 * - setTerminatedHandler: notifica cuando el proceso pi muere.
 * - setErrorHandler: notifica líneas de stderr.
 */
export interface PiEventBus {
  sendCommand(json: string): Promise<void>;
  setEventHandler(handler: (line: string) => void): void;
  setTerminatedHandler(handler: (code: number | null) => void): void;
  setErrorHandler(handler: (line: string) => void): void;
}

/**
 * Evento de extensión UI que pi envía para pedir interacción
 * (approve, ask, select, confirm, input).
 */
export interface ExtensionUiRequest {
  type: string;
  [key: string]: unknown;
}

/**
 * Handler para eventos de extensión UI. Recibe el request y
 * debe retornar la respuesta (promesa).
 */
export type ExtensionUiHandler = (req: ExtensionUiRequest) => Promise<unknown>;
