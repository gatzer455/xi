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
// ponytail: add ExtensionUiRequest + ExtensionUiHandler when mobile approve exists

/**
 * Bus de eventos entre el frontend y pi.
 *
 * - connect: inicializa la conexión (TauriEventBus es no-op, WsEventBus abre WS).
 * - sendCommand: envía un JSON al stdin de pi.
 * - setEventHandler: registra el handler que recibe cada línea de stdout.
 *   Solo un handler a la vez (el último set reemplaza al anterior).
 * - setTerminatedHandler: notifica cuando el proceso pi muere.
 * - setErrorHandler: notifica líneas de stderr.
 */
export interface PiEventBus {
  connect(): Promise<void>;
  sendCommand(json: string): Promise<void>;
  setEventHandler(handler: (line: string) => void): void;
  setTerminatedHandler(handler: (code: number | null) => void): void;
  setErrorHandler(handler: (line: string) => void): void;
}
