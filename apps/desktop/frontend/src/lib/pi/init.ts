/**
 * init.ts — Registra los listeners de Tauri que reciben eventos de pi.
 *
 * Es el único módulo del paquete `pi/` que llama a `listen()`. Esa
 * separación existe para que `tauri-commands.ts` quede como funciones
 * puras de envío, sin mezcla de suscripción y envío en el mismo archivo.
 *
 * `initPiConnection` se llama una vez desde `main.ts`. Si se llama dos
 * veces, los listeners anteriores se destruyen antes de registrar los
 * nuevos: la función es idempotente y no acumula handlers fantasma.
 *
 * `destroyPiConnection` existe para limpieza futura (cierre de ventana,
 * logout). No se usa todavía.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { appState } from '../state.ts';
import { addEntry } from '../debug-panel.ts';
import { parsePiEvent } from './event-parser.ts';
import { applyEvent, endStream } from './state-sync.ts';
import { initExtensionUIHandler } from './extension-ui-handler.ts';

let unlistenRaw: UnlistenFn | null = null;
let unlistenErr: UnlistenFn | null = null;
let unlistenTerminated: UnlistenFn | null = null;

export async function initPiConnection(): Promise<void> {
  destroyPiConnection();

  // Iniciar handler de extension UI (select, confirm, input, etc.)
  initExtensionUIHandler();

  unlistenRaw = await listen<string>('pi:raw', (event) => {
    const parsed = parsePiEvent(event.payload);
    if (parsed === null) {
      addEntry('in', `[non-JSON] ${event.payload.slice(0, 200)}`);
      return;
    }
    applyEvent(parsed);
  });

  unlistenErr = await listen<string>('pi:err', (event) => {
    addEntry('system', `[stderr] ${event.payload}`);
  });

  unlistenTerminated = await listen<number | null>('pi:terminated', (event) => {
    addEntry('system', `pi terminated with code: ${event.payload}`);
    // Limpiar routing del stream: si pi muere mid-stream, el flag
    // global y streamingSessionId deben resetearse o el InputBar
    // queda trabado en modo Stop.
    endStream();
  });
}

export function destroyPiConnection(): void {
  unlistenRaw?.();
  unlistenErr?.();
  unlistenTerminated?.();
  unlistenRaw = null;
  unlistenErr = null;
  unlistenTerminated = null;
}
