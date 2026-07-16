/**
 * Tests para sessions.ts — reset de signals module-level.
 *
 * El bug: los signals `sessions`, `loading`, `error`, `renamingPath`
 * viven a nivel de módulo. Sin reset, conservan estado entre mounts.
 * Si el user entra a un workspace que falla y luego cambia a uno
 * válido, la UI se queda pegada mostrando el error o las sesiones
 * del workspace anterior hasta que el polling (10s) las refresque.
 *
 * El fix: `resetSessionsState()` se llama al inicio de `SessionsPage()`
 * y resetea los 5 signals (incluido `skipped`) a sus valores iniciales.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  sessions,
  loading,
  error,
  skipped,
  renamingPath,
  resetSessionsState,
} from '../src/pages/sessions.ts';
import type { SessionInfo } from 'xi-ui/lib/pi/types.ts';

describe('resetSessionsState', () => {
  beforeEach(() => {
    // Asegurar estado limpio antes de cada test
    resetSessionsState();
  });

  it('resetea sessions a array vacío', () => {
    // Ensuciar: simular sesiones cargadas de un workspace anterior
    sessions.value = [
      {
        path: '/tmp/old-session.jsonl',
        id: 'abc123',
        cwd: '/tmp',
        created: 1700000000000,
        modified: 1700000001000,
        messageCount: 5,
        firstMessage: 'mensaje viejo',
      },
    ];

    resetSessionsState();

    expect(sessions.value).toEqual([]);
  });

  it('resetea loading a false', () => {
    // Ensuciar: simular carga en progreso
    loading.value = true;

    resetSessionsState();

    expect(loading.value).toBe(false);
  });

  it('resetea error a null', () => {
    // Ensuciar: simular error del workspace anterior
    error.value = 'failed to parse pi-sessions output: EOF while parsing';

    resetSessionsState();

    expect(error.value).toBeNull();
  });

  it('resetea renamingPath a null', () => {
    // Ensuciar: simular rename en progreso
    renamingPath.value = '/tmp/some-session.jsonl';

    resetSessionsState();

    expect(renamingPath.value).toBeNull();
  });

  it('resetea skipped a null', () => {
    // Ensuciar: simular archivos corruptos detectados
    skipped.value = { count: 3 };

    resetSessionsState();

    expect(skipped.value).toBeNull();
  });

  it('resetea todos los signals a la vez', () => {
    // Ensuciar todo
    sessions.value = [
      {
        path: '/x',
        id: 'x',
        cwd: '/x',
        created: 1,
        modified: 2,
        messageCount: 1,
        firstMessage: 'x',
      } as SessionInfo,
    ];
    loading.value = true;
    error.value = 'error previo';
    skipped.value = { count: 2 };
    renamingPath.value = '/some/path';

    resetSessionsState();

    expect(sessions.value).toEqual([]);
    expect(loading.value).toBe(false);
    expect(error.value).toBeNull();
    expect(skipped.value).toBeNull();
    expect(renamingPath.value).toBeNull();
  });

  it('es idempotente: llamar dos veces no rompe', () => {
    resetSessionsState();
    resetSessionsState();

    expect(sessions.value).toEqual([]);
    expect(loading.value).toBe(false);
    expect(error.value).toBeNull();
    expect(skipped.value).toBeNull();
    expect(renamingPath.value).toBeNull();
  });

  it('no pierde suscriptores al resetear', () => {
    // El reset cambia .value, lo que dispara los suscriptores.
    // Si el signal estuviera roto, el suscriptor no recibiría la update.
    let lastSessions: SessionInfo[] | null = null;
    const unsub = sessions.subscribe((v) => {
      lastSessions = v;
    });

    sessions.value = [
      {
        path: '/dirty',
        id: 'd',
        cwd: '/',
        created: 1,
        modified: 1,
        messageCount: 0,
        firstMessage: 'dirty',
      } as SessionInfo,
    ];
    expect(lastSessions).toHaveLength(1);

    resetSessionsState();
    expect(lastSessions).toEqual([]);

    unsub();
  });
});
