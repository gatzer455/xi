/**
 * extension-ui-handler.ts — Maneja `extension_ui_request` en mobile.
 *
 * A diferencia de desktop (evento Tauri separado, ver
 * apps/desktop/frontend/src/lib/pi/extension-ui-handler.ts), en mobile
 * `extension_ui_request` llega como una línea JSONL más del passthrough
 * WS (docs/mobile/03-protocolo.md). `ws-init.ts` la intercepta acá ANTES
 * de pasarla a parsePiEvent/applyEvent.
 */
import type { ExtensionUIRequest } from 'xi-ui/lib/pi/types.ts';
import type { PiEventBus } from 'xi-ui/lib/pi/transport.ts';

export type DialogRenderer = (
  method: string,
  request: ExtensionUIRequest,
) => Promise<Record<string, unknown>>;

let dialogRenderer: DialogRenderer | null = null;
let bus: PiEventBus | null = null;

/** Lo llama chat.ts al montarse, para proveer el renderer del bottom sheet. */
export function setDialogRenderer(renderer: DialogRenderer): void {
  dialogRenderer = renderer;
}

export function clearDialogRenderer(): void {
  dialogRenderer = null;
}

/** Lo llama ws-init.ts al conectar — necesitamos el bus para responder. */
export function setExtensionUIBus(b: PiEventBus): void {
  bus = b;
}

/**
 * Intenta interpretar `raw` como un extension_ui_request. Retorna true
 * si lo era (y ya lo manejó); false si el caller debe seguir el flujo
 * normal (parsePiEvent/applyEvent).
 */
export async function tryHandleExtensionUIRequest(raw: string): Promise<boolean> {
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return false; }
  if (typeof obj !== 'object' || obj === null) return false;
  const request = obj as ExtensionUIRequest;
  if (request.type !== 'extension_ui_request') return false;

  // notify y setStatus son fire-and-forget (docs/mobile/03-protocolo.md):
  // no esperan respuesta, así que no se encolan como dialog. setStatus no
  // está en el union de ExtensionUIRequest (xi-ui/lib/pi/types.ts) — cast
  // puntual para leer su `message` sin ampliar el tipo compartido acá.
  if (request.method === 'notify') {
    const prefix = request.notifyType === 'warning' ? '⚠️' : request.notifyType === 'error' ? '❌' : 'ℹ️';
    console.log(`[extension-ui] ${prefix} ${request.message}`);
    return true;
  }
  if ((request as { method: string }).method === 'setStatus') {
    console.log(`[extension-ui] status: ${(request as unknown as { message?: string }).message ?? ''}`);
    return true;
  }

  if (!dialogRenderer) {
    console.error('[extension-ui] No dialog renderer registered, cancelling request');
    await respondWithCancelled(request.id);
    return true;
  }

  try {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Dialog timeout')), 120_000);
    });
    const response = await Promise.race([dialogRenderer(request.method, request), timeout]);
    await sendResponse(request.id, response);
  } catch (error) {
    console.warn('[extension-ui] Dialog cancelled or failed:', error);
    await respondWithCancelled(request.id);
  }
  return true;
}

async function sendResponse(id: string, response: Record<string, unknown>): Promise<void> {
  await bus?.sendCommand(JSON.stringify({ type: 'extension_ui_response', id, ...response }));
}

async function respondWithCancelled(id: string): Promise<void> {
  await sendResponse(id, { cancelled: true });
}
