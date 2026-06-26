/**
 * stores.ts — Registry de ChatStores per-tab.
 *
 * Mantiene un Map<SessionId, ChatStore>. Cada tab de xi tiene su
 * propio store, aislado de los demás. El registry es el único
 * lugar que sabe qué stores existen — los componentes piden el
 * store por sessionId.
 *
 * Decisiones de diseño:
 * - D7: cada tab tiene su propio store. Los eventos de pi se
 *   rutan al store correcto via `streamingSessionId` en
 *   `state-sync.ts` (etapa 4).
 * - R5.3: no hay límite de stores. La limpieza es responsabilidad
 *   del caller (al cerrar un tab, llamar `dropStore`).
 *
 * El registry es module-level y singleton — vivo durante toda la
 * app. Es la única excepción a "no module-level mutable" del D2,
 * porque es un registry, no estado de chat. El estado de chat
 * vive dentro de cada ChatStore.
 */

import type { SessionId } from './types.ts';
import { createChatStore } from './store.ts';
import type { ChatStore } from './store.ts';

export type { ChatStore } from './store.ts';

const stores = new Map<SessionId, ChatStore>();

/** Retorna el ChatStore para `sessionId`. Si no existe, lo crea.
 *
 *  Misma `sessionId` → mismo store (misma referencia). Esto es
 *  clave para que los componentes que se desmontan y re-montan
 *  (ej: ChatPage al cambiar de tab) conserven el estado. */
export function getStore(sessionId: SessionId): ChatStore {
  let store = stores.get(sessionId);
  if (!store) {
    store = createChatStore(sessionId);
    stores.set(sessionId, store);
  }
  return store;
}

/** Elimina el store del registry. Llamar al cerrar un tab.
 *
 *  Después de `dropStore`, `getStore(id)` crea un store nuevo
 *  (estado fresco). El store viejo se GC si nada más lo referencia. */
export function dropStore(sessionId: SessionId): void {
  stores.delete(sessionId);
}

/** Para tests: limpia todos los stores. No usar en producción. */
export function clearStores(): void {
  stores.clear();
}

/** Lista de sessionIds con store activo. Para debugging. */
export function activeSessionIds(): SessionId[] {
  return Array.from(stores.keys());
}
