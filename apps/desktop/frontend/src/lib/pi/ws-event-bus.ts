/**
 * ws-event-bus.ts — PiEventBus via WebSocket (mobile, hacia xi-serve).
 *
 * Conecta a xi-serve (el daemon Rust que spawnea pi en el homeserver).
 * Envía comandos como mensajes WS, recibe eventos como mensajes WS.
 *
 * Uso:
 *   const bus = new WsEventBus('ws://homeserver:9876/ws');
 *   await bus.connect();
 *   initPiConnection(bus);
 *
 * Reconexión automática con backoff exponencial (1s, 2s, 4s, … máx 30s).
 */

import type { PiEventBus } from './transport.ts';

type EventHandler = (line: string) => void;
type TerminatedHandler = (code: number | null) => void;
type ErrorHandler = (line: string) => void;

export class WsEventBus implements PiEventBus {
  private url: string;
  private ws: WebSocket | null = null;
  private eventHandler: EventHandler | null = null;
  private terminatedHandler: TerminatedHandler | null = null;
  private errorHandler: ErrorHandler | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private destroyed = false;

  /** Señal de estado de conexión: 'connected' | 'reconnecting' | 'offline' */
  readonly connectionState: { value: 'connected' | 'reconnecting' | 'offline' } = { value: 'offline' };

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<void> {
    this.destroyed = false;
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
      } catch (e) {
        reject(e);
        return;
      }

      this.ws.onopen = () => {
        this.connectionState.value = 'connected';
        this.reconnectDelay = 1000;
        resolve();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          this.eventHandler?.(event.data);
        }
      };

      this.ws.onerror = () => {
        this.connectionState.value = 'offline';
        // No reject — el WebSocket API no da detalles en onerror.
        // Si no se abrió nunca, reject en timeout.
      };

      this.ws.onclose = (event: CloseEvent) => {
        this.ws = null;
        if (!this.destroyed) {
          this.scheduleReconnect();
        }
        if (event.code === 1006 && !this.destroyed) {
          // 1006 = conexión cerrada anormal (ej: servidor murió)
          this.terminatedHandler?.(null);
        }
      };

      // Timeout si no se conecta en 10s
      setTimeout(() => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          reject(new Error('Timeout conectando a xi-serve'));
        }
      }, 10000);
    });
  }

  /** Envía un comando JSON a pi via WebSocket. */
  async sendCommand(json: string): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(json);
    }
  }

  setEventHandler(handler: (line: string) => void): void {
    this.eventHandler = handler;
  }

  setTerminatedHandler(handler: (code: number | null) => void): void {
    this.terminatedHandler = handler;
  }

  setErrorHandler(handler: (line: string) => void): void {
    this.errorHandler = handler;
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    this.connectionState.value = 'reconnecting';
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {});
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  /** Cierra la conexión y detiene la reconexión automática. */
  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.connectionState.value = 'offline';
  }
}

/** Helper: crea un WsEventBus conectado, listo para pasar a initPiConnection. */
export async function connectWsBus(url: string): Promise<WsEventBus> {
  const bus = new WsEventBus(url);
  await bus.connect();
  return bus;
}
