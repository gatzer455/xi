/**
 * ws-init.ts — Inicializa la conexión con xi-serve.
 *
 * Equivalente mobile de apps/desktop/frontend/src/lib/pi/init.ts: en vez
 * de TauriEventBus, usa WsEventBus + setCommandBus(bus, true). Cada línea
 * pasa primero por `tryHandleExtensionUIRequest` (extension_ui_request no
 * tiene envelope propio, llega como passthrough — ver docs/mobile/03).
 *
 * Resync al reconectar: WsEventBus ya reintenta con backoff exponencial
 * internamente; acá solo detectamos la transición reconnecting/offline →
 * connected (via poll de 1s, ponytail: WsEventBus no expone un callback
 * de reconexión, agregar si el poll resulta insuficiente) y pedimos
 * get_state + get_messages, igual que hace desktop al abrir una sesión
 * existente (docs/mobile/03-protocolo.md § Reconexión).
 */
import { WsEventBus } from 'xi-ui/lib/pi/ws-event-bus.ts';
import { setCommandBus, getPiState, getPiMessages } from 'xi-ui/lib/pi/tauri-commands.ts';
import { addEntry } from 'xi-ui/lib/debug-panel.ts';
import { appState } from 'xi-ui/lib/state.ts';
import { parsePiEvent } from 'xi-ui/lib/pi/event-parser.ts';
import { applyEvent, endStream } from 'xi-ui/lib/pi/state-sync.ts';
import { tryHandleExtensionUIRequest, setExtensionUIBus } from './extension-ui-handler.ts';
import { connectionState } from './connection-state.ts';

let bus: WsEventBus | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

export async function connectToServer(wsUrl: string): Promise<void> {
  disconnectFromServer();

  bus = new WsEventBus(wsUrl);
  setCommandBus(bus, true);
  setExtensionUIBus(bus);

  await bus.connect();
  connectionState.value = 'connected';

  bus.setEventHandler((line: string) => {
    void tryHandleExtensionUIRequest(line).then((handled) => {
      if (handled) return;
      const parsed = parsePiEvent(line);
      if (parsed === null) {
        addEntry('in', `[non-JSON] ${line.slice(0, 200)}`);
        return;
      }
      applyEvent(parsed);
    });
  });

  bus.setErrorHandler((line: string) => {
    addEntry('system', `[stderr] ${line}`);
  });

  bus.setTerminatedHandler((code: number | null) => {
    addEntry('system', `pi terminated with code: ${code}`);
    endStream();
  });

  let wasConnected = true;
  pollTimer = setInterval(() => {
    if (!bus) return;
    const next = bus.connectionState;
    connectionState.value = next;
    if (next === 'connected' && !wasConnected && appState.activeTabId.value) {
      addEntry('system', 'reconectado — resync get_state + get_messages');
      void getPiState();
      void getPiMessages();
    }
    wasConnected = next === 'connected';
  }, 1000);
}

export function disconnectFromServer(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  bus?.disconnect();
  bus = null;
  connectionState.value = 'offline';
}
