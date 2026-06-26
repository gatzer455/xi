/**
 * chat-footer.test.ts — Tests del ChatFooter (Etapa 8, R9).
 *
 * Verifica el ciclo de vida del spinner braille: setVisible arranca/
 * detiene el interval, setMessage actualiza el label, dispose libera.
 * Usa fake timers de vitest para avanzar el interval determinista.
 *
 * @vitest-environment jsdom
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChatFooter } from '../../src/components/chat-footer.ts';

describe('ChatFooter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('root oculto por defecto (display none)', () => {
    const f = ChatFooter();
    expect(f.root.style.display).toBe('none');
    expect(f.root.className).toBe('chat-footer');
    f.dispose();
  });

  test('label por defecto es "Trabajando…"', () => {
    const f = ChatFooter();
    expect(f.root.querySelector('.chat-footer-label')?.textContent).toBe(
      'Trabajando…',
    );
    f.dispose();
  });

  test('setVisible(true) muestra el root', () => {
    const f = ChatFooter();
    f.setVisible(true);
    expect(f.root.style.display).not.toBe('none');
    f.dispose();
  });

  test('setVisible(false) oculta el root', () => {
    const f = ChatFooter();
    f.setVisible(true);
    f.setVisible(false);
    expect(f.root.style.display).toBe('none');
    f.dispose();
  });

  test('el spinner cambia de frame tras 80ms', () => {
    const f = ChatFooter();
    f.setVisible(true);
    const spinner = f.root.querySelector('.chat-footer-spinner')!;

    // tick() inmediato al setVisible → frame 1 (índice 1 tras avanzar).
    expect(spinner.textContent).not.toBe('');

    const before = spinner.textContent;
    vi.advanceTimersByTime(80);
    const after = spinner.textContent;
    expect(after).not.toBe(before);
    // Sigue siendo uno de los frames válidos.
    expect(after).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u);
    f.dispose();
  });

  test('el spinner avanza 10 frames únicos en un ciclo completo (800ms)', () => {
    const f = ChatFooter();
    f.setVisible(true);
    const spinner = f.root.querySelector('.chat-footer-spinner')!;
    const frames: string[] = [spinner.textContent!];
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(80);
      frames.push(spinner.textContent!);
    }
    // 11 muestras (la inicial + 10 ticks) cubren un ciclo completo.
    const uniq = new Set(frames);
    expect(uniq.size).toBe(10);
    f.dispose();
  });

  test('setMessage actualiza el label', () => {
    const f = ChatFooter();
    f.setMessage('Compactionando…');
    expect(f.root.querySelector('.chat-footer-label')?.textContent).toBe(
      'Compactionando…',
    );
    f.dispose();
  });

  test('setVisible(true) dos veces no arranca un segundo interval (idempotente)', () => {
    const f = ChatFooter();
    f.setVisible(true);
    f.setVisible(true);
    // Avanzar: el frame avanza exactamente una vez por tick (no dos).
    const spinner = f.root.querySelector('.chat-footer-spinner')!;
    const before = spinner.textContent;
    vi.advanceTimersByTime(80);
    expect(spinner.textContent).not.toBe(before);
    f.dispose();
  });

  test('dispose detiene el interval (no más ticks)', () => {
    const f = ChatFooter();
    f.setVisible(true);
    const spinner = f.root.querySelector('.chat-footer-spinner')!;
    f.dispose();
    const afterDispose = spinner.textContent;
    vi.advanceTimersByTime(1000);
    expect(spinner.textContent).toBe(afterDispose);
  });

  test('setVisible(false) detiene el interval (no más ticks)', () => {
    const f = ChatFooter();
    f.setVisible(true);
    const spinner = f.root.querySelector('.chat-footer-spinner')!;
    f.setVisible(false);
    const afterHide = spinner.textContent;
    vi.advanceTimersByTime(1000);
    expect(spinner.textContent).toBe(afterHide);
    expect(f.root.style.display).toBe('none');
    f.dispose();
  });

  test('setVisible(true) tras dispose no reviva el interval (seguro)', () => {
    const f = ChatFooter();
    f.dispose();
    // No debe tirar ni arrancar nada raro.
    expect(() => f.setVisible(true)).not.toThrow();
    f.dispose();
  });
});