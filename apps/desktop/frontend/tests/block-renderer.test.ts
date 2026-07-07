/**
 * Tests de BlockRenderer — Gemini-style progressive markdown rendering.
 *
 * Verifica:
 *  - extractCompletedBlocks() en todos los tipos de bloques
 *  - closeInlineSyntax() para cierre especulativo
 *  - push() incremental con inserción DOM
 *  - flush() del bloque pendiente
 *  - reset() y dispose()
 *
 * @vitest-environment jsdom
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  BlockRenderer,
  extractCompletedBlocks,
  closeInlineSyntax,
} from '../src/lib/block-renderer.ts';

// ─── extractCompletedBlocks ──────────────────────────────

describe('extractCompletedBlocks', () => {
  test('texto sin separadores → todo pending', () => {
    const { completed, pending } = extractCompletedBlocks('Hola mundo');
    expect(completed).toBe('');
    expect(pending).toBe('Hola mundo');
  });

  test('párrafo simple → completado con \\n\\n', () => {
    const { completed, pending } = extractCompletedBlocks(
      'Primer párrafo.\n\nSegundo párrafo.',
    );
    expect(completed).toBe('Primer párrafo.');
    expect(pending).toBe('\n\nSegundo párrafo.');
  });

  test('heading + párrafo', () => {
    const { completed, pending } = extractCompletedBlocks(
      '# Título\n\nEste es el contenido.',
    );
    expect(completed).toBe('# Título');
    expect(pending).toBe('\n\nEste es el contenido.');
  });

  test('code fence completo → corte después del cierre', () => {
    const { completed, pending } = extractCompletedBlocks(
      '```js\nconst x = 1;\n```\n\nDespués del código.',
    );
    expect(completed).toContain('```js\nconst x = 1;\n```');
    expect(pending).toBe('\n\nDespués del código.');
  });

  test('code fence abierto (sin cierre) → todo pending', () => {
    const { completed, pending } = extractCompletedBlocks(
      'Antes del código.\n\n```js\nconst x = 1;\nconst y = 2;',
    );
    // El texto antes del fence debería estar completado
    expect(completed).toBe('Antes del código.');
    // Todo desde el fence abierto es pending
    expect(pending).toContain('```js');
    expect(pending).toContain('const x = 1;');
  });

  test('múltiples párrafos → solo el último pendiente', () => {
    const { completed, pending } = extractCompletedBlocks(
      'Párrafo uno.\n\nPárrafo dos.\n\nPárrafo tres (incompleto',
    );
    expect(completed).toContain('Párrafo uno.');
    expect(completed).toContain('Párrafo dos.');
    expect(pending).toContain('Párrafo tres (incompleto');
  });

  test('horizontal rule → corte', () => {
    const { completed, pending } = extractCompletedBlocks(
      'Antes de la línea.\n\n---\n\nDespués.',
    );
    expect(completed).toContain('Antes de la línea.');
    expect(pending).toContain('Después.');
  });

  test('texto vacío', () => {
    const { completed, pending } = extractCompletedBlocks('');
    expect(completed).toBe('');
    expect(pending).toBe('');
  });

  test('solo whitespace', () => {
    const { completed, pending } = extractCompletedBlocks('   \n\n   ');
    // Las líneas vacías no marcan cortes si no hay contenido antes
    expect(completed).toBe('');
    expect(pending).toBe('   \n\n   ');
  });
});

// ─── closeInlineSyntax ───────────────────────────────────

describe('closeInlineSyntax', () => {
  test('bold sin cerrar → cierra con **', () => {
    const result = closeInlineSyntax('Texto **en negrita sin cerrar');
    expect(result).toBe('Texto **en negrita sin cerrar**');
  });

  test('bold cerrado → sin cambios', () => {
    const result = closeInlineSyntax('Texto **en negrita** cerrado');
    expect(result).toBe('Texto **en negrita** cerrado');
  });

  test('italic sin cerrar → cierra con *', () => {
    const result = closeInlineSyntax('Texto *en cursiva sin cerrar');
    expect(result).toBe('Texto *en cursiva sin cerrar*');
  });

  test('inline code sin cerrar → cierra con `', () => {
    const result = closeInlineSyntax('Usa `el comando sin cerrar');
    expect(result).toBe('Usa `el comando sin cerrar`');
  });

  test('strikethrough sin cerrar → cierra con ~~', () => {
    const result = closeInlineSyntax('Texto ~~tachado sin cerrar');
    expect(result).toBe('Texto ~~tachado sin cerrar~~');
  });

  test('bold + italic sin cerrar → cierra ambos', () => {
    const result = closeInlineSyntax('Texto **bold y *cursiva sin cerrar');
    expect(result).toMatch(/\*\*$/);   // cierra bold
    expect(result).toMatch(/\*$/);      // cierra italic
  });

  test('texto sin inline syntax → sin cambios', () => {
    const result = closeInlineSyntax('Texto normal sin formato.');
    expect(result).toBe('Texto normal sin formato.');
  });

  test('múltiples bold en una línea → sin cambios si pares', () => {
    const result = closeInlineSyntax('**uno** y **dos** cerrados');
    expect(result).toBe('**uno** y **dos** cerrados');
  });

  test('texto vacío', () => {
    const result = closeInlineSyntax('');
    expect(result).toBe('');
  });
});

// ─── BlockRenderer (DOM) ─────────────────────────────────

describe('BlockRenderer', () => {
  let container: HTMLElement;
  let renderer: BlockRenderer;

  beforeEach(() => {
    container = document.createElement('div');
    renderer = new BlockRenderer(container);
  });

  test('push de chunk sin completar bloque → no inserta en DOM', () => {
    renderer.push('Hola ');
    expect(container.children.length).toBe(0);
    expect(renderer.hasPending).toBe(true);
  });

  test('push de bloque completo → inserta en DOM', () => {
    renderer.push('Un párrafo completo.\n\n');
    expect(container.children.length).toBe(1);
    expect(container.children[0].className).toContain('md-block');
    expect(container.children[0].className).toContain('block-appear');
    // El párrafo ya se completó, pending debería ser solo whitespace
    // (la línea vacía del separador queda como pending)
  });

  test('push de múltiples chunks que forman bloques', () => {
    renderer.push('# Título');
    expect(container.children.length).toBe(0); // aún no hay \n\n

    renderer.push('\n\nPrimer párrafo completo.\n\n');
    expect(container.children.length).toBe(1); // el heading se completó
    expect(container.children[0].innerHTML).toContain('Título');

    renderer.push('Segundo párrafo.\n\nTercero.');
    expect(container.children.length).toBe(2); // dos párrafos
  });

  test('code fence se renderiza solo al cerrarse', () => {
    renderer.push('Antes.\n\n```js\nconst x = 1;\n');
    // El párrafo "Antes." sí se completó
    expect(container.children.length).toBe(1);
    expect(container.children[0].textContent).toContain('Antes');

    renderer.push('const y = 2;\n```\n\n');
    // Ahora el code fence se cerró → debe aparecer
    expect(container.children.length).toBe(2);
    const codeBlock = container.children[1];
    // textContent contiene el source sin tags HTML
    expect(codeBlock.textContent || '').toContain('const x = 1;');
    expect(codeBlock.textContent || '').toContain('const y = 2;');
    // highlight.js debería haber marcado el código
    expect(codeBlock.querySelector('code') || codeBlock.querySelector('pre')).toBeTruthy();
  });

  test('flush drena el bloque pendiente', () => {
    renderer.push('Párrafo sin cerrar');
    expect(container.children.length).toBe(0);

    renderer.flush();
    expect(container.children.length).toBe(1);
    expect(container.children[0].textContent).toContain('Párrafo sin cerrar');
    expect(renderer.hasPending).toBe(false);
  });

  test('flush sin pending → no-op', () => {
    renderer.push('Completo.\n\n');
    const countBefore = container.children.length;
    renderer.flush();
    expect(container.children.length).toBe(countBefore);
  });

  test('reset limpia el buffer', () => {
    renderer.push('Texto pendiente');
    expect(renderer.hasPending).toBe(true);

    renderer.reset();
    expect(renderer.hasPending).toBe(false);
    // El DOM no se toca en reset
  });

  test('dispose → push y flush son no-op', () => {
    renderer.push('Algo');
    renderer.dispose();

    renderer.push('Más texto');
    renderer.flush();
    expect(container.children.length).toBe(0); // nada se insertó
    expect(renderer.hasPending).toBe(false);
  });

  test('onBlock callback se dispara por cada bloque', () => {
    const blocks: string[] = [];
    const r = new BlockRenderer(container, {
      onBlock: (el) => blocks.push(el.textContent || ''),
    });

    r.push('Uno.\n\nDos.\n\nTres.');
    // "Uno." y "Dos." se completan como bloques separados por \n\n
    // Ambos se renderizan juntos en un solo renderMarkdown() → 1 bloque DOM
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toContain('Uno');
    expect(blocks[0]).toContain('Dos');

    r.flush();
    expect(blocks.length).toBe(2);
    expect(blocks[1]).toContain('Tres');
  });

  test('onDone callback se dispara en flush', () => {
    let done = false;
    const r = new BlockRenderer(container, {
      onDone: () => { done = true; },
    });

    r.push('Texto.\n\n');
    r.flush();
    expect(done).toBe(true);
  });

  test('onPending refleja el estado del buffer', () => {
    const pendingStates: boolean[] = [];
    const r = new BlockRenderer(container, {
      onPending: (p) => pendingStates.push(p),
    });

    r.push('Hola');
    expect(pendingStates[pendingStates.length - 1]).toBe(true);

    r.push(' mundo.\n\n');
    // Después de completar un bloque, pending puede ser true (si quedó whitespace)
    // o false (si todo se consumió)
  });

  test('bold inline incompleto se cierra antes de renderizar', () => {
    renderer.push('Texto con **negrita sin cerrar\n\n');
    // Debería haberse insertado un bloque con bold renderizado
    expect(container.children.length).toBeGreaterThanOrEqual(1);
    const html = container.children[0].innerHTML;
    // markdown-it convierte ** en <strong> (con clase md-strong)
    expect(html).toContain('<strong');
    expect(html).not.toContain('**negrita sin cerrar**'); // no debe verse el markup crudo
  });

  test('push después de dispose → no-op sin error', () => {
    renderer.dispose();
    expect(() => renderer.push('texto')).not.toThrow();
    expect(() => renderer.flush()).not.toThrow();
    expect(container.children.length).toBe(0);
  });

  test('múltiples flushes consecutivos son seguros', () => {
    renderer.push('A.\n\n');
    renderer.flush();
    renderer.flush(); // segundo flush
    renderer.flush(); // tercer flush
    expect(container.children.length).toBeGreaterThanOrEqual(1);
  });
});
