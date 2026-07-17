/**
 * init.ts — Inicializa la conexión con pi.
 *
 * Crea un PiEventBus (TauriEventBus por defecto para desktop),
 * registra los handlers que parsean eventos y alimentan el state-sync,
 * y expone initPiConnection/destroyPiConnection para el ciclo de vida.
 */

import type { PiEventBus } from 'xi-ui/lib/pi/transport.ts';
import { TauriEventBus } from './tauri-event-bus.ts';
import { setCommandBus } from 'xi-ui/lib/pi/tauri-commands.ts';
import { appState } from 'xi-ui/lib/state.ts';
import { addEntry } from 'xi-ui/lib/debug-panel.ts';
import { parsePiEvent } from 'xi-ui/lib/pi/event-parser.ts';
import { applyEvent, endStream } from 'xi-ui/lib/pi/state-sync.ts';
import { initExtensionUIHandler } from './extension-ui-handler.ts';

let bus: PiEventBus | null = null;

/**
 * Inicializa la conexión con pi. Opcionalmente recibe un PiEventBus
 * custom (tests); si no se pasa, usa TauriEventBus.
 */
export async function initPiConnection(customBus?: PiEventBus): Promise<void> {
  destroyPiConnection();

  bus = customBus ?? new TauriEventBus();

  // Registrar el bus ANTES de conectar, para que el ruteo (isMobile)
  // esté correcto incluso si la conexión falla. Si no se registra,
  // comandos como startPi caen a Tauri IPC y fallan con
  // "command not found" en mobile.
  setCommandBus(bus, !!customBus);

  try {
    await bus.connect();
  } catch (e) {
    addEntry('system', `Error conectando a xi-serve: ${e}`);
    throw e;
  }

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
