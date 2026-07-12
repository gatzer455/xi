/**
 * init.ts — Inicializa la conexión con pi.
 *
 * Crea un PiEventBus (TauriEventBus por defecto para desktop),
 * registra los handlers que parsean eventos y alimentan el state-sync,
 * y expone initPiConnection/destroyPiConnection para el ciclo de vida.
 *
 * Para mobile, se llamaría initPiConnection(new WsEventBus(url)) en vez
 * del TauriEventBus por defecto.
 */

import type { PiEventBus } from './transport.ts';
import { TauriEventBus } from './tauri-event-bus.ts';
import { appState } from '../state.ts';
import { addEntry } from '../debug-panel.ts';
import { parsePiEvent } from './event-parser.ts';
import { applyEvent, endStream } from './state-sync.ts';
import { initExtensionUIHandler } from './extension-ui-handler.ts';

let bus: PiEventBus | null = null;

/**
 * Inicializa la conexión con pi. Opcionalmente recibe un PiEventBus;
 * si no se pasa, usa TauriEventBus (desktop).
 */
export async function initPiConnection(customBus?: PiEventBus): Promise<void> {
  destroyPiConnection();

  bus = customBus ?? new TauriEventBus();

  // Iniciar handler de extension UI (select, confirm, input, etc.)
  initExtensionUIHandler();

  bus.setEventHandler((line: string) => {
    const parsed = parsePiEvent(line);
    if (parsed === null) {
      addEntry('in', `[non-JSON] ${line.slice(0, 200)}`);
      return;
    }
    applyEvent(parsed);
  });

  bus.setErrorHandler((line: string) => {
    addEntry('system', `[stderr] ${line}`);
  });

  bus.setTerminatedHandler((code: number | null) => {
    addEntry('system', `pi terminated with code: ${code}`);
    endStream();
  });
}

export function destroyPiConnection(): void {
  if (bus instanceof TauriEventBus) {
    bus.destroy();
  }
  bus = null;
}
