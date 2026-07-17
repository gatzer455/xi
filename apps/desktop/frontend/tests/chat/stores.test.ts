/**
 * stores.test.ts — Tests del registry multi-tab.
 *
 * @vitest-environment node
 *
 * Verifica:
 * - getStore retorna mismo store para mismo sessionId
 * - getStore crea store nuevo para sessionId distinto
 * - dropStore elimina el store; getStore posterior crea uno nuevo
 * - Stores aislados: dispatch en uno no afecta al otro
 * - clearStores limpia todo
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getStore, dropStore, clearStores, activeSessionIds } from 'xi-ui/lib/chat/stores.ts';

describe('stores registry — getStore', () => {
  beforeEach(() => {
    clearStores();
  });

  it('mismo sessionId → mismo store (misma referencia)', () => {
    const a = getStore('tab-1');
    const b = getStore('tab-1');
    expect(a).toBe(b);
  });

  it('distinto sessionId → referencias distintas', () => {
    const a = getStore('tab-1');
    const b = getStore('tab-2');
    expect(a).not.toBe(b);
  });

  it('crea store con estado fresco', () => {
    const store = getStore('tab-fresh');
    expect(store.messages$.value).toEqual([]);
    expect(store.isStreaming$.value).toBe(false);
  });
});

describe('stores registry — dropStore', () => {
  beforeEach(() => {
    clearStores();
  });

  it('dropStore elimina el store', () => {
    const a = getStore('tab-1');
    dropStore('tab-1');
    const b = getStore('tab-1');
    expect(b).not.toBe(a);
  });

  it('dropStore de id inexistente → no rompe', () => {
    expect(() => dropStore('no-existo')).not.toThrow();
  });

  it('dropStore no afecta otros stores', () => {
    const a = getStore('tab-1');
    const b = getStore('tab-2');
    dropStore('tab-1');
    expect(getStore('tab-2')).toBe(b);
    // a sigue existiendo (referencia), pero no en el registry.
    // getStore('tab-1') crea uno nuevo.
    expect(getStore('tab-1')).not.toBe(a);
  });
});

describe('stores registry — aislamiento', () => {
  beforeEach(() => {
    clearStores();
  });

  it('dispatch en store A no afecta store B', () => {
    const a = getStore('tab-a');
    const b = getStore('tab-b');

    a.dispatch({ type: 'init', session: null, messages: [{
      id: 'u_1', role: 'user',
      parts: [{ type: 'text', text: 'hola A' }],
      timestamp: 1000,
    }]});

    expect(a.messages$.value).toHaveLength(1);
    expect(b.messages$.value).toEqual([]);
  });

  it('isStreaming aislado', () => {
    const a = getStore('tab-a');
    const b = getStore('tab-b');

    a.dispatch({ type: 'agent_start' });
    expect(a.isStreaming$.value).toBe(true);
    expect(b.isStreaming$.value).toBe(false);
  });

  it('dispatch en A y B → states independientes', () => {
    const a = getStore('tab-a');
    const b = getStore('tab-b');

    a.dispatch({ type: 'agent_start' });
    b.dispatch({ type: 'init', session: null, messages: [{
      id: 'u_b', role: 'user',
      parts: [{ type: 'text', text: 'hola B' }],
      timestamp: 2000,
    }]});

    expect(a.isStreaming$.value).toBe(true);
    expect(a.messages$.value).toEqual([]);
    expect(b.isStreaming$.value).toBe(false);
    expect(b.messages$.value).toHaveLength(1);
  });
});

describe('stores registry — clearStores', () => {
  beforeEach(() => {
    clearStores();
  });

  it('limpia todos los stores', () => {
    getStore('tab-1');
    getStore('tab-2');
    expect(activeSessionIds()).toHaveLength(2);

    clearStores();
    expect(activeSessionIds()).toHaveLength(0);
  });
});

describe('stores registry — activeSessionIds', () => {
  beforeEach(() => {
    clearStores();
  });

  it('lista sessionIds activos', () => {
    getStore('tab-1');
    getStore('tab-2');
    getStore('tab-3');
    const ids = activeSessionIds();
    expect(ids.sort()).toEqual(['tab-1', 'tab-2', 'tab-3']);
  });

  it('vacío al inicio', () => {
    expect(activeSessionIds()).toEqual([]);
  });
});
