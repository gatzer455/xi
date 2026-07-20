/**
 * slash-menu.test.ts — Tests del dropdown de autocomplete slash.
 *
 * @vitest-environment jsdom
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { SlashMenu, type SlashMenuItem } from 'xi-ui/components/slash-menu.ts';

const CMD_FIXTURES: SlashMenuItem[] = [
  { name: 'compact', description: 'Compactar la sesión', argumentHint: '[instr]' },
  { name: 'new', description: 'Nueva sesión' },
  { name: 'clone', description: 'Duplicar sesión' },
  { name: 'bash', description: 'Ejecutar shell', argumentHint: '<cmd>' },
  { name: 'help', description: 'Mostrar ayuda' },
];

describe('SlashMenu', () => {
  let onSelect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSelect = vi.fn();
  });

  test('renderiza items con nombre, arg y descripción', () => {
    const m = SlashMenu(onSelect);
    m.open(CMD_FIXTURES, '');
    expect(m.visible).toBe(true);
    const items = m.el.querySelectorAll('.slash-menu-item');
    expect(items.length).toBe(5);
    // Primer item: compact
    expect(items[0].querySelector('.slash-menu-name')!.textContent).toBe('compact');
    expect(items[0].querySelector('.slash-menu-arg')!.textContent).toContain('[instr]');
    expect(items[0].querySelector('.slash-menu-desc')!.textContent).toBe('Compactar la sesión');
  });

  test('filtra por query', () => {
    const m = SlashMenu(onSelect);
    m.open(CMD_FIXTURES, 'clo');
    const items = m.el.querySelectorAll('.slash-menu-item');
    expect(items.length).toBe(1);
    expect(items[0].querySelector('.slash-menu-name')!.textContent).toBe('clone');
  });

  test('query vacío muestra todos', () => {
    const m = SlashMenu(onSelect);
    m.open(CMD_FIXTURES, '');
    expect(m.el.querySelectorAll('.slash-menu-item').length).toBe(5);
  });

  test('sin matches oculta el menú', () => {
    const m = SlashMenu(onSelect);
    m.open(CMD_FIXTURES, 'zzz');
    expect(m.visible).toBe(false);
  });

  test('moveDown/moveUp navegan el highlight', () => {
    const m = SlashMenu(onSelect);
    m.open(CMD_FIXTURES, '');
    // Primer item highlighted por defecto
    let hl = m.el.querySelector('.slash-menu-item--highlighted')!;
    expect(hl.querySelector('.slash-menu-name')!.textContent).toBe('compact');

    m.moveDown();
    hl = m.el.querySelector('.slash-menu-item--highlighted')!;
    expect(hl.querySelector('.slash-menu-name')!.textContent).toBe('new');

    m.moveUp();
    hl = m.el.querySelector('.slash-menu-item--highlighted')!;
    expect(hl.querySelector('.slash-menu-name')!.textContent).toBe('compact');

    // moveUp wraps al último
    m.moveUp();
    hl = m.el.querySelector('.slash-menu-item--highlighted')!;
    expect(hl.querySelector('.slash-menu-name')!.textContent).toBe('help');

    // moveDown wraps al primero
    m.moveDown();
    hl = m.el.querySelector('.slash-menu-item--highlighted')!;
    expect(hl.querySelector('.slash-menu-name')!.textContent).toBe('compact');
  });

  test('selectHighlighted llama onSelect con el item destacado', () => {
    const m = SlashMenu(onSelect);
    m.open(CMD_FIXTURES, '');
    m.moveDown();
    m.selectHighlighted();
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0][0].name).toBe('new');
  });

  test('close oculta el menú', () => {
    const m = SlashMenu(onSelect);
    m.open(CMD_FIXTURES, '');
    m.close();
    expect(m.visible).toBe(false);
  });

  test('click en item llama onSelect (mousedown)', () => {
    const m = SlashMenu(onSelect);
    m.open(CMD_FIXTURES, '');
    const firstItem = m.el.querySelector('.slash-menu-item')!;
    firstItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0][0].name).toBe('compact');
  });
});
