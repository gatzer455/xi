/**
 * Tests del render de streaming: reparación de markdown incompleto
 * (holdIncomplete* + strips) — remend eliminado (v0.3.2).
 *
 * Invariantes:
 *   1. Sintaxis de BLOQUE cruda ($$ incompleto) nunca aparece.
 *   2. Sintaxis INLINE cruda (**bold, `code) PUEDE aparecer por 1 frame
 *      sin remend — aceptable a 60fps.
 *   3. holdIncompleteTable / holdIncompleteMath verificados por separado.
 *
 * @vitest-environment jsdom
 */
import { describe, test, expect } from 'vitest';
import {
  renderStreamingMarkdown,
  holdIncompleteTable,
} from 'xi-ui/lib/markdown.ts';

function visibleText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}

describe('holdIncompleteTable', () => {
  test('retiene una fila de tabla sin separador', () => {
    expect(holdIncompleteTable('Intro\n| Col A | Col B |')).toBe('Intro');
  });

  test('no retiene una vez que llega el separador', () => {
    const t = 'Intro\n| Col A | Col B |\n|---|---|';
    expect(holdIncompleteTable(t)).toBe(t);
  });

  test('no retiene prosa con un solo pipe', () => {
    const t = 'Usa `a | b` para OR';
    expect(holdIncompleteTable(t)).toBe(t);
  });

  test('no toca texto sin pipes', () => {
    const t = 'Un párrafo normal.';
    expect(holdIncompleteTable(t)).toBe(t);
  });
});

describe('renderStreamingMarkdown — inline syntax', () => {
  test('bold a medio cerrar: asteriscos visibles (sin remend), se cierra al final', () => {
    const html = renderStreamingMarkdown('Hola **negr');
    expect(visibleText(html)).toContain('**');
    expect(visibleText(html)).toContain('negr');
    // Con buffer completo → bold renderizado correctamente
    const finalHtml = renderStreamingMarkdown('Hola **negr**');
    expect(visibleText(finalHtml)).not.toContain('*');
    expect(finalHtml).toMatch(/<strong[^>]*>negr<\/strong>/);
  });

  test('inline code a medio cerrar: backtick visible (sin remend)', () => {
    const html = renderStreamingMarkdown('Corre `npm ru');
    expect(visibleText(html)).toContain('`');
  });

  test('link a medio escribir: URL visible (sin remend)', () => {
    const html = renderStreamingMarkdown('Ver [la doc](https://ejem');
    const text = visibleText(html);
    expect(text).toContain('la doc');
    expect(text).toContain('https://ejem');
  });
});

describe('renderStreamingMarkdown — block syntax (holdIncomplete*)', () => {
  test('tabla a medio formar no muestra pipes crudos', () => {
    const html = renderStreamingMarkdown('Datos:\n| Col A | Col B |');
    const text = visibleText(html);
    expect(text).not.toContain('|');
    expect(text).toContain('Datos:');
  });

  test('math de bloque incompleto se retiene (no crashea temml, no muestra $$)', () => {
    const html = renderStreamingMarkdown('Antes $$E = mc^');
    const text = visibleText(html);
    expect(text).toContain('Antes');
    expect(text).not.toContain('$$');
    expect(text).not.toContain('mc^');
  });

  test('code fence sin cerrar se renderiza como bloque de código (no snap)', () => {
    const html = renderStreamingMarkdown('```python\nprint("hola")');
    expect(html).toContain('<pre');
    expect(html).toContain('<code');
  });
});
