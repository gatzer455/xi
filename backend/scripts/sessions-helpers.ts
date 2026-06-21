/**
 * sessions-helpers.ts — Funciones de utilidad para el manejo de sesiones.
 *
 * Extraídas de `pi-sessions.ts` para que sean testeables de forma aislada.
 * El sidecar (`pi-sessions.ts`) las importa y las usa; los tests las
 * verifican sin necesidad de mockear el pi package completo.
 *
 * Estas funciones son puras (o dependen solo de node:path/node:os) y
 * replican la lógica que pi usa internamente para descubrir el directorio
 * de sesiones y leer IDs de archivos JSONL.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Lee el `id` del último entry de un contenido JSONL, o null si está vacío.
 *
 * El JSONL de pi tiene un entry por línea. El último entry representa el
 * "leaf" del árbol de conversación. `cmdRename` lo necesita para vincular
 * el nuevo entry `session_info` al último entry de la conversación.
 *
 * Si la última línea no es JSON válida, devuelve null (no lanza). Esto
 * protege contra archivos corruptos — en vez de crashear, el rename
 * pierde el parentId y el entry session_info queda huérfano, que es
 * mejor que un panic.
 */
export function readLeafId(jsonlContent: string): string | null {
  const lines = jsonlContent.split("\n").filter((line) => line.trim());
  if (lines.length === 0) return null;
  const lastLine = lines[lines.length - 1];
  if (!lastLine) return null;
  try {
    const entry = JSON.parse(lastLine) as { id?: unknown };
    return typeof entry.id === "string" ? entry.id : null;
  } catch {
    return null;
  }
}

/**
 * Resuelve el directorio de sesiones default para un cwd.
 *
 * Replica la lógica interna de `@earendil-works/pi-coding-agent`:
 * `~/.pi/agent/sessions/--<encoded-cwd>--`.
 * El encoding reemplaza el leading `/` o `\` y los separadores con `-`.
 *
 * NOTA: Si pi cambia su lógica de encoding, hay que actualizar esta
 * función para que xi siga viendo las mismas sesiones que el usuario ve
 * en la TUI de pi.
 */
export function getDefaultSessionDir(cwd: string): string {
  const resolvedCwd = resolve(cwd);
  const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(homedir(), ".pi", "agent", "sessions", safePath);
}
