/**
 * connection-state.ts — Estado de conexión con xi-serve.
 *
 * Exclusivo de mobile: desktop habla IPC local, nunca puede
 * "perder conexión" con pi de la misma forma. Alimentado por
 * ws-init.ts (poll del `connectionState` de WsEventBus).
 */
import { signal } from 'xi-ui/lib/signal.ts';

export type ConnState = 'connected' | 'reconnecting' | 'offline';

export const connectionState = signal<ConnState>('offline');
