/**
 * signal.test.ts — Tests para la signal (Capa 2: Reactividad)
 *
 * Testea: valor inicial, setter con cambio, setter sin cambio,
 * subscribe, unsubscribe, múltiples suscriptores.
 */

import { describe, it, expect, vi } from 'vitest';
import { signal } from '../src/lib/signal.ts';

describe('signal', () => {
  // ─── Valor inicial ────────────────────────────────────────
  it('retorna el valor inicial', () => {
    const count = signal(0);
    expect(count.value).toBe(0);
  });

  it('funciona con tipos complejos', () => {
    const user = signal({ name: 'Nego', age: 30 });
    expect(user.value).toEqual({ name: 'Nego', age: 30 });
  });

  // ─── Setter ───────────────────────────────────────────────
  it('actualiza el valor al hacer set', () => {
    const count = signal(0);
    count.value = 5;
    expect(count.value).toBe(5);
  });

  it('notifica suscriptores al cambiar', () => {
    const count = signal(0);
    const fn = vi.fn();
    count.subscribe(fn);

    // subscribe ya llamó fn una vez con el valor inicial
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(0);

    count.value = 10;
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenCalledWith(10);
  });

  it('NO notifica si el valor es el mismo (referencial)', () => {
    const count = signal(0);
    const fn = vi.fn();
    count.subscribe(fn);

    count.value = 0; // mismo valor
    expect(fn).toHaveBeenCalledTimes(1); // solo el subscribe inicial
  });

  it('NO notifica si el valor es el mismo (objeto)', () => {
    const obj = signal({ x: 1 });
    const fn = vi.fn();
    obj.subscribe(fn);

    obj.value = { x: 1 }; // mismo contenido, distinta referencia
    expect(fn).toHaveBeenCalledTimes(2); // SÍ notifica (referencia distinta)
  });

  // ─── Subscribe ────────────────────────────────────────────
  it('ejecuta el callback inmediatamente al suscribirse', () => {
    const count = signal(42);
    const fn = vi.fn();
    count.subscribe(fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(42);
  });

  it('soporta múltiples suscriptores', () => {
    const count = signal(0);
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    count.subscribe(fn1);
    count.subscribe(fn2);

    count.value = 1;

    expect(fn1).toHaveBeenCalledTimes(2); // subscribe + set
    expect(fn2).toHaveBeenCalledTimes(2); // subscribe + set
  });

  it('cada suscriptor recibe el mismo valor', () => {
    const count = signal(0);
    const values1: number[] = [];
    const values2: number[] = [];

    count.subscribe(v => values1.push(v));
    count.subscribe(v => values2.push(v));

    count.value = 1;
    count.value = 2;
    count.value = 3;

    expect(values1).toEqual([0, 1, 2, 3]);
    expect(values2).toEqual([0, 1, 2, 3]);
  });

  // ─── Unsubscribe ──────────────────────────────────────────
  it('unsubscribe detiene las notificaciones', () => {
    const count = signal(0);
    const fn = vi.fn();

    const unsub = count.subscribe(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    unsub();
    count.value = 1;
    count.value = 2;

    expect(fn).toHaveBeenCalledTimes(1); // solo el subscribe inicial
  });

  it('unsubscribe no afecta a otros suscriptores', () => {
    const count = signal(0);
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    const unsub1 = count.subscribe(fn1);
    count.subscribe(fn2);

    unsub1();
    count.value = 1;

    expect(fn1).toHaveBeenCalledTimes(1); // solo subscribe
    expect(fn2).toHaveBeenCalledTimes(2); // subscribe + set
  });

  it('llamar unsubscribe dos veces no causa error', () => {
    const count = signal(0);
    const fn = vi.fn();

    const unsub = count.subscribe(fn);
    unsub();
    unsub(); // segunda vez

    count.value = 1;
    expect(fn).toHaveBeenCalledTimes(1); // no afecta
  });

  // ─── Edge cases ───────────────────────────────────────────
  it('funciona con null', () => {
    const s = signal<string | null>(null);
    expect(s.value).toBeNull();

    s.value = 'hello';
    expect(s.value).toBe('hello');
  });

  it('funciona con undefined', () => {
    const s = signal<number | undefined>(undefined);
    expect(s.value).toBeUndefined();

    s.value = 42;
    expect(s.value).toBe(42);
  });

  it('funciona con string vacío', () => {
    const s = signal('');
    expect(s.value).toBe('');

    s.value = 'not empty';
    expect(s.value).toBe('not empty');
  });

  it('funciona con 0 y false', () => {
    const num = signal(0);
    const bool = signal(false);

    expect(num.value).toBe(0);
    expect(bool.value).toBe(false);

    num.value = 1;
    bool.value = true;

    expect(num.value).toBe(1);
    expect(bool.value).toBe(true);
  });
});
