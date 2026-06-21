// @vitest-environment node
/**
 * Tests para sessions-helpers.ts — funciones puras del sidecar pi-sessions.
 *
 * Ver `backend/scripts/sessions-helpers.ts`. Estas funciones replican
 * lógica interna de `@earendil-works/pi-coding-agent` y deben mantenerse
 * sincronizadas. Si pi cambia su encoding de sessionDir, este test falla
 * y avisa que hay que actualizar la réplica.
 */

import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readLeafId, getDefaultSessionDir } from '../../backend/scripts/sessions-helpers.ts';

describe('readLeafId', () => {
  it('devuelve el id de la última línea JSONL', () => {
    const content = '{"id":"abc","type":"message"}\n{"id":"def","type":"message"}\n';
    expect(readLeafId(content)).toBe('def');
  });

  it('devuelve null si el contenido está vacío', () => {
    expect(readLeafId('')).toBeNull();
  });

  it('devuelve null si solo hay whitespace', () => {
    expect(readLeafId('  \n  \n')).toBeNull();
  });

  it('devuelve null si la última línea no tiene id', () => {
    const content = '{"id":"abc"}\n{"type":"no-id"}\n';
    expect(readLeafId(content)).toBeNull();
  });

  it('devuelve null si el id no es string', () => {
    const content = '{"id":123}\n';
    expect(readLeafId(content)).toBeNull();
  });

  it('devuelve null si la última línea no es JSON válido', () => {
    // El catch en readLeafId protege contra archivos corruptos
    const content = '{"id":"abc"}\nnot-json\n';
    expect(readLeafId(content)).toBeNull();
  });

  it('maneja líneas vacías entre medio', () => {
    const content = '{"id":"a"}\n\n{"id":"b"}\n';
    expect(readLeafId(content)).toBe('b');
  });

  it('funciona con una sola línea', () => {
    const content = '{"id":"only-one"}\n';
    expect(readLeafId(content)).toBe('only-one');
  });

  it('funciona sin newline final', () => {
    const content = '{"id":"first"}\n{"id":"last"}';
    expect(readLeafId(content)).toBe('last');
  });
});

describe('getDefaultSessionDir', () => {
  it('incluye el cwd encoded en el path', () => {
    const dir = getDefaultSessionDir('/home/user/projects/mi-proyecto');
    expect(dir).toContain('--home-user-projects-mi-proyecto--');
  });

  it('usa el directorio .pi/agent/sessions bajo el homedir', () => {
    const dir = getDefaultSessionDir('/tmp/test');
    expect(dir).toBe(
      join(homedir(), '.pi', 'agent', 'sessions', '--tmp-test--')
    );
  });

  it('NO encodea espacios (replica el comportamiento exacto de pi)', () => {
    const dir = getDefaultSessionDir('/home/user/mi proyecto');
    // El regex solo reemplaza /, \, : — los espacios se conservan.
    // Esto replica el encoding de @earendil-works/pi-coding-agent.
    expect(dir).toContain('--home-user-mi proyecto--');
  });

  it('encodea correctamente paths con dos puntos (Windows-style)', () => {
    const dir = getDefaultSessionDir('/home/user/test:path');
    expect(dir).toContain('--home-user-test-path--');
  });

  it('encodea correctamente la barra leading', () => {
    // El leading / se elimina (replace /^[/\\]/)
    const dir = getDefaultSessionDir('/tmp/foo');
    expect(dir).toContain('--tmp-foo--');
    expect(dir).not.toContain('---tmp'); // no debe tener triple --
  });

  it('resuelve paths relativos antes de encodear', () => {
    const dir = getDefaultSessionDir('relative/path');
    const resolved = resolve('relative/path');
    const encoded = `--${resolved.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
    expect(dir).toContain(encoded);
  });
});
