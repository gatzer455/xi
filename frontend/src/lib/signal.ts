/**
 * signal.ts — Capa 2 (Reactivity)
 *
 * Una signal es una caja con un valor que notifica a suscriptores
 * cuando cambia. No hay VDOM, no hay diffing, no hay scheduling.
 *
 * Cada signal conoce a quién notificar. Cuando haces
 * `count.value = 7`, el setter recorre la lista de suscriptores
 * y ejecuta sus callbacks.
 *
 * Copiado de musicologo, sin cambios.
 */

export interface Signal<T> {
  get value(): T;
  set value(v: T);
  /** Suscribe al callback. Retorna una función que, al llamarla,
   *  des-suscribe este callback. Usar para cleanup en componentes
   *  que se desmontan (sin cleanup, los callbacks se acumulan
   *  en el Set interno de la signal — memory leak). */
  subscribe(fn: (v: T) => void): () => void;
}

export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const subscribers = new Set<(v: T) => void>();

  return {
    get value() {
      return value;
    },

    set value(next: T) {
      if (next === value) return;
      value = next;
      subscribers.forEach(fn => fn(value));
    },

    subscribe(fn: (v: T) => void) {
      subscribers.add(fn);
      fn(value);
      return () => { subscribers.delete(fn); };
    },
  };
}
