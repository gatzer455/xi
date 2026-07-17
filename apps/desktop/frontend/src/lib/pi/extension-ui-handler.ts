/**
 * extension-ui-handler.ts — Escucha `extension-ui-request` del backend
 * y delega al renderer del dialog.
 *
 * El flow es:
 * 1. pi emite `extension_ui_request` por stdout
 * 2. El backend intercepta, guarda pending request, emite event al frontend
 * 3. Este módulo recibe el event y llama al renderer registrado
 * 4. El renderer muestra el dialog y espera la respuesta del usuario
 * 5. El renderer invoca `respond_extension_ui` al backend
 * 6. El backend escribe `extension_ui_response` a stdin de pi
 *
 * Para `notify` (fire-and-forget), no se invoca respond_extension_ui —
 * solo se muestra un toast/mensaje.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ExtensionUIRequest } from 'xi-ui/lib/pi/types.ts';

// ─── Renderer ─────────────────────────────────────────────────────────────────

/**
 * Callback que el chat registra para renderizar dialogs de extensiones.
 *
 * Recibe el method y el request completo. Retorna una Promise que se
 * resuelve con la respuesta del usuario, o se rechaza si cancela.
 */
export type DialogRenderer = (
  method: string,
  request: ExtensionUIRequest,
) => Promise<Record<string, unknown>>;

let dialogRenderer: DialogRenderer | null = null;

/**
 * Registrar el renderer del dialog.
 *
 * Lo llama `chat.ts` al montarse para proveer la función que
 * renderiza los dialogs dentro del chat.
 */
export function setDialogRenderer(renderer: DialogRenderer): void {
  dialogRenderer = renderer;
}

/**
 * Quitar el renderer del dialog.
 *
 * Lo llama `chat.ts` al desmontarse para limpiar la referencia.
 */
export function clearDialogRenderer(): void {
  dialogRenderer = null;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Iniciar el listener de `extension-ui-request`.
 *
 * Se llama una vez al inicio de la app (desde `pi/index.ts`).
 * Registra un listener Tauri que recibe los events del backend.
 */
export function initExtensionUIHandler(): void {
  listen<ExtensionUIRequest>('extension-ui-request', async (event) => {
    const request = event.payload;

    // notify y setStatus son fire-and-forget — no necesitan respuesta.
    // setStatus no está en el union de ExtensionUIRequest (xi-ui/lib/pi/types.ts)
    // — cast puntual para leer su `message` sin ampliar el tipo compartido acá.
    if (request.method === 'notify') {
      handleNotify(request);
      return;
    }
    if ((request as { method: string }).method === 'setStatus') {
      console.log(`[extension-ui] status: ${(request as unknown as { message?: string }).message ?? ''}`);
      return;
    }

    // Sin renderer registrado — cancelar automáticamente
    if (!dialogRenderer) {
      console.error('[extension-ui] No dialog renderer registered, cancelling request');
      await respondWithCancelled(request.id);
      return;
    }

    try {
      // Timeout de seguridad: si el dialog está abierto 120s, cancelar.
      // Pi tiene su propio timeout, pero esto previene chats bloqueados
      // si el usuario cierra xi sin responder.
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Dialog timeout')), 120_000);
      });

      const response = await Promise.race([
        dialogRenderer(request.method, request),
        timeout,
      ]);

      await invoke('respond_extension_ui', {
        id: request.id,
        response,
      });
    } catch (error) {
      // Usuario canceló, timeout, o error — enviar cancelled
      console.warn('[extension-ui] Dialog cancelled or failed:', error);
      await respondWithCancelled(request.id);
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function respondWithCancelled(id: string): Promise<void> {
  try {
    await invoke('respond_extension_ui', {
      id,
      response: { cancelled: true },
    });
  } catch (error) {
    console.error('[extension-ui] Failed to send cancelled response:', error);
  }
}

function handleNotify(request: ExtensionUIRequest): void {
  if (request.method !== 'notify') return;

  // Por ahora, loguear al console. En v2, mostrar toast en el chat.
  const prefix = request.notifyType === 'warning' ? '⚠️' :
                 request.notifyType === 'error' ? '❌' : 'ℹ️';
  console.log(`[extension-ui] ${prefix} ${request.message}`);
}
