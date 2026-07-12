/**
 * ws-event-bus.ts — PiEventBus via WebSocket (mobile, hacia xi-serve).
 *
 * Conecta a xi-serve (el daemon Rust que spawnea pi en el homeserver).
 * Envía comandos como mensajes WS, recibe eventos como mensajes WS.
 *
 * Reconexión automática con backoff exponencial (1s, 2s, 4s, … máx 30s).
 */

import type { PiEventBus } from './transport.ts';

export class WsEventBus implements PiEventBus {
  private url: string;
  private ws: WebSocket | null = null;
  private eventHandler: ((line: string) => void) | null = null;
  private terminatedHandler: ((code: number | null) => void) | null = null;
  private errorHandler: ((line: string) => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private destroyed = false;

  /** Estado de conexión */
  connectionState: 'connected' | 'reconnecting' | 'offline' = 'offline';

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

      const timeout = setTimeout(() => {
        this.ws?.close();
        this.ws = null;
        reject(new Error('Timeout conectando a xi-serve'));
      }, 10000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        this.connectionState = 'connected';
        this.reconnectDelay = 1000;
        resolve();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          this.eventHandler?.(event.data);
        }
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
        this.connectionState = 'offline';
        reject(new Error('Error de conexión WebSocket'));
      };

      this.ws.onclose = (event: CloseEvent) => {
        this.ws = null;
        if (!this.destroyed) {
          this.scheduleReconnect();
        }
        if (event.code === 1006 && !this.destroyed) {
          this.terminatedHandler?.(null);
        }
      };
    });
  }

  async sendCommand(json: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket no conectado');
    }
    this.ws.send(json);
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
    this.connectionState = 'reconnecting';
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {});
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.connectionState = 'offline';
  }
}
