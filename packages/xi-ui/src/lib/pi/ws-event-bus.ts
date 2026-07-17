/**
 * ws-event-bus.ts — PiEventBus via WebSocket (mobile, hacia xi-serve).
 *
 * Conecta a xi-serve (el daemon Rust que spawnea pi en el homeserver).
 *
 * Dos tipos de mensajes:
 *   - sendCommand(json) → texto plano, xi-serve lo pipea a pi
 *   - invoke(method, params) → {"id": N, "method": "xi_*", ...}
 *     xi-serve lo intercepta y responde con {"id": N, "result": ...}
 *
 * Reconexión automática con backoff exponencial (1s, 2s, 4s, … máx 30s).
 */

import type { PiEventBus } from './transport.ts';

let nextInvokeId = 1;

type PendingInvoke = {
  resolve: (val: unknown) => void;
  reject: (err: Error) => void;
};

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
  private pending = new Map<number, PendingInvoke>();

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
        if (typeof event.data !== 'string') return;
        // Distinguir invoke-response de eventos de pi
        if (this.tryHandleInvokeResponse(event.data)) return;
        this.eventHandler?.(event.data);
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
        this.connectionState = 'offline';
        reject(new Error('Error de conexión WebSocket'));
      };

      this.ws.onclose = (event: CloseEvent) => {
        this.ws = null;
        this.rejectAllPending(new Error('Conexión cerrada'));
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

  async invoke<T>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket no conectado');
    }
    const id = nextInvokeId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject } as PendingInvoke);
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
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

  private tryHandleInvokeResponse(data: string): boolean {
    let obj: unknown;
    try { obj = JSON.parse(data); } catch { return false; }
    if (typeof obj !== 'object' || obj === null) return false;
    const msg = obj as Record<string, unknown>;
    if (typeof msg.id !== 'number') return false;
    const pending = this.pending.get(msg.id);
    if (!pending) return false;
    this.pending.delete(msg.id);
    if ('error' in msg) {
      pending.reject(new Error(String(msg.error)));
    } else {
      pending.resolve(msg.result);
    }
    return true;
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pending) {
      pending.reject(err);
      this.pending.delete(id);
    }
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
    this.rejectAllPending(new Error('Desconectado'));
  }
}
