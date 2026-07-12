/**
 * tauri-event-bus.ts — PiEventBus via Tauri IPC (desktop actual).
 *
 * Envía comandos con invoke('send_pi_command') y recibe eventos
 * con listen('pi:raw'/pi:err/pi:terminated).
 *
 * Es el reemplazo de init.ts: en vez de registrar listeners globales,
 * TauriEventBus los administra y delega los eventos a los handlers
 * que el pipeline registre.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { PiEventBus } from './transport.ts';

export class TauriEventBus implements PiEventBus {
  private handler: ((line: string) => void) | null = null;
  private terminatedHandler: ((code: number | null) => void) | null = null;
  private errorHandler: ((line: string) => void) | null = null;
  private unlistenRaw: UnlistenFn | null = null;
  private unlistenErr: UnlistenFn | null = null;
  private unlistenTerminated: UnlistenFn | null = null;

  async sendCommand(json: string): Promise<void> {
    await invoke('send_pi_command', { json });
  }

  setEventHandler(handler: (line: string) => void): void {
    this.handler = handler;
    // Registrar listener si es primera vez
    if (!this.unlistenRaw) {
      this.initRawListener();
    }
  }

  setTerminatedHandler(handler: (code: number | null) => void): void {
    this.terminatedHandler = handler;
    if (!this.unlistenTerminated) {
      this.initTerminatedListener();
    }
  }

  setErrorHandler(handler: (line: string) => void): void {
    this.errorHandler = handler;
    if (!this.unlistenErr) {
      this.initErrorListener();
    }
  }

  private async initRawListener(): Promise<void> {
    this.unlistenRaw = await listen<string>('pi:raw', (event) => {
      this.handler?.(event.payload);
    });
  }

  private async initTerminatedListener(): Promise<void> {
    this.unlistenTerminated = await listen<number | null>('pi:terminated', (event) => {
      this.terminatedHandler?.(event.payload);
    });
  }

  private async initErrorListener(): Promise<void> {
    this.unlistenErr = await listen<string>('pi:err', (event) => {
      this.errorHandler?.(event.payload);
    });
  }

  /** Limpia los listeners Tauri al destruir el bus. */
  destroy(): void {
    this.unlistenRaw?.();
    this.unlistenErr?.();
    this.unlistenTerminated?.();
    this.unlistenRaw = null;
    this.unlistenErr = null;
    this.unlistenTerminated = null;
    this.handler = null;
    this.terminatedHandler = null;
    this.errorHandler = null;
  }
}
