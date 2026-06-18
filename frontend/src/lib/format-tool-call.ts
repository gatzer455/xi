/**
 * format-tool-call.ts — Formatea el header de un tool call para que sea
 * legible en el chat, fiel a pi TUI.
 *
 * Pi formatea cada tool built-in con un patrón diferente:
 *   - bash: `$ <command>`
 *   - read: `read <path>:<lineRange>`
 *   - write/edit/ls: `<name> <path>`
 *   - find: `find <pattern> in <path>`
 *   - grep: `grep /<pattern>/ in <path>`
 *
 * Para tools custom (de extensions) o tools built-in con args no estándar,
 * usamos una heurística genérica: si hay 1 solo argumento string,
 * `<name> <arg>`. Si hay varios, fallback a `<name> <json-truncado>`.
 *
 * Refs:
 *   - bash.js:110 formatBashCall
 *   - read.js:34 formatReadCall
 *   - write.js:93 formatWriteCall
 *   - edit.js:96 formatEditCall
 *   - find.js:28 formatFindCall
 *   - grep.js:27 formatGrepCall
 *   - ls.js:20 formatLsCall
 */

import type { ToolCall } from './state.ts';

const JSON_FALLBACK_MAX_CHARS = 60;

export function formatToolCallHeader(tc: ToolCall): string {
  const args = tc.arguments as Record<string, unknown> | undefined;
  const name = tc.name;

  switch (name) {
    case 'bash':
      return `$ ${strArg(args, 'command') ?? '...'}`;

    case 'read': {
      const path = strArg(args, 'file_path') ?? strArg(args, 'path') ?? '?';
      const range = formatReadLineRange(args);
      return `read ${path}${range}`;
    }

    case 'write':
      return `write ${strArg(args, 'file_path') ?? strArg(args, 'path') ?? '?'}`;

    case 'edit':
      return `edit ${strArg(args, 'file_path') ?? strArg(args, 'path') ?? '?'}`;

    case 'find': {
      const pattern = strArg(args, 'pattern') ?? '?';
      const path = strArg(args, 'path') ?? '.';
      const limit = args?.['limit'];
      const limitSuffix = limit !== undefined ? ` (limit ${limit})` : '';
      return `find ${pattern} in ${path}${limitSuffix}`;
    }

    case 'grep': {
      const pattern = strArg(args, 'pattern') ?? '?';
      const path = strArg(args, 'path') ?? '.';
      const glob = strArg(args, 'glob');
      const limit = args?.['limit'];
      const globSuffix = glob ? ` (${glob})` : '';
      const limitSuffix = limit !== undefined ? ` limit ${limit}` : '';
      return `grep /${pattern}/ in ${path}${globSuffix}${limitSuffix}`;
    }

    case 'ls': {
      const path = strArg(args, 'path') ?? '.';
      const limit = args?.['limit'];
      const limitSuffix = limit !== undefined ? ` (limit ${limit})` : '';
      return `ls ${path}${limitSuffix}`;
    }

    default: {
      // Heurística genérica: 1 solo arg string → `<name> <arg>`. Si no, JSON.
      if (args) {
        const stringArgs = Object.values(args).filter(v => typeof v === 'string');
        if (stringArgs.length === 1) {
          return `${name} ${stringArgs[0]}`;
        }
      }
      const json = JSON.stringify(args ?? {});
      const truncated = json.length > JSON_FALLBACK_MAX_CHARS
        ? json.slice(0, JSON_FALLBACK_MAX_CHARS) + '…'
        : json;
      return `${name} ${truncated}`;
    }
  }
}

// ───────────────────────────────────────────────────────────────
// Helpers privados
// ───────────────────────────────────────────────────────────────

function strArg(args: Record<string, unknown> | undefined, key: string): string | null {
  if (!args) return null;
  const v = args[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function formatReadLineRange(args: Record<string, unknown> | undefined): string {
  if (!args) return '';
  const start = args['start_line'];
  if (typeof start !== 'number') return '';
  const end = args['end_line'];
  return typeof end === 'number' ? `:${start}-${end}` : `:${start}`;
}
