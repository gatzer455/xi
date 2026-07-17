/**
 * settings-storage.ts — Capa 2 (Storage)
 *
 * Persistencia local de tema y font size en localStorage. Modelo y
 * thinking NO pasan por acá: usan RPC de pi (ver tauri-commands.ts),
 * que ya escribe a <cwd>/.pi/settings.json o ~/.pi/agent/settings.json.
 *
 * Reglas de code-style aplicadas:
 * - Parse, don't validate: isTheme/isFontSize son type guards.
 *   Si localStorage tiene un valor corrupto, retornamos el default.
 * - Funciones puras (sin estado interno). Mutan APIs explícitas
 *   (localStorage, document.documentElement) que son side effects
 *   intencionales.
 * - Logging: NO silenciamos errores. Las funciones que leen
 *   retornan default ante input inválido (no hay nada que loguear).
 */

import type { ThemeMode, FontSize } from 'xi-ui/lib/state.ts';

// ═══════════════════════════════════════════════════════
// Constantes
// ═══════════════════════════════════════════════════════

const KEY_THEME = 'xi.theme';
const KEY_FONT = 'xi.fontSize';

// Sets de validación. ReadonlySet es más liviano que Array.includes
// para valores pequeños y hace explícito que no se mutan.
const VALID_THEMES: ReadonlySet<ThemeMode> = new Set<ThemeMode>([
  'dark',
  'light',
  'system',
]);
const VALID_FONTS: ReadonlySet<FontSize> = new Set<FontSize>([
  'small',
  'medium',
  'large',
]);

// ═══════════════════════════════════════════════════════
// Theme
// ═══════════════════════════════════════════════════════

/**
 * Lee el theme de localStorage. Default: 'dark' si no hay o es inválido.
 *
 * Por qué 'dark' y no 'system' como default: queremos un fallback
 * explícito al cargar. El media query del CSS se encarga del 'system'
 * cuando el usuario lo elige explícitamente desde la UI.
 */
export function loadTheme(): ThemeMode {
  const raw = localStorage.getItem(KEY_THEME);
  return isTheme(raw) ? raw : 'dark';
}

/** Persiste el theme en localStorage. */
export function saveTheme(theme: ThemeMode): void {
  localStorage.setItem(KEY_THEME, theme);
}

/** Aplica el theme al DOM via data-theme. 'system' remueve el atributo
 *  para que el media query del CSS decida. */
export function applyThemeToDOM(theme: ThemeMode): void {
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

// ═══════════════════════════════════════════════════════
// Font size
// ═══════════════════════════════════════════════════════

/** Lee el fontSize de localStorage. Default: 'medium'. */
export function loadFontSize(): FontSize {
  const raw = localStorage.getItem(KEY_FONT);
  return isFontSize(raw) ? raw : 'medium';
}

/** Persiste el fontSize en localStorage. */
export function saveFontSize(size: FontSize): void {
  localStorage.setItem(KEY_FONT, size);
}

/** Aplica el font size al DOM via data-font-size. El CSS lo reescala
 *  vía --font-size-base. */
export function applyFontToDOM(size: FontSize): void {
  document.documentElement.setAttribute('data-font-size', size);
}

// ═══════════════════════════════════════════════════════
// Type guards (privados)
// ═══════════════════════════════════════════════════════

function isTheme(value: string | null): value is ThemeMode {
  return value !== null && VALID_THEMES.has(value as ThemeMode);
}

function isFontSize(value: string | null): value is FontSize {
  return value !== null && VALID_FONTS.has(value as FontSize);
}
