/**
 * pi-sessions — CLI para gestión de sesiones de pi.
 *
 * Operaciones:
 *   list <cwd>                         Lista sesiones del directorio activo.
 *   delete <session-path>              Borra el archivo JSONL de la sesión.
 *   rename <session-path> <new-name>   Renombra la sesión (agrega entry session_info).
 *
 * Contrato:
 *   stdout = JSON con el resultado. stderr = mensaje de error en caso de fallo.
 *   exit 0 = ok, exit 1 = error.
 *
 * xi debe hacer lo mismo que hace pi en la TUI para descubrir el directorio
 * de sesiones: la TUI usa `SettingsManager.create(cwd).getSessionDir()` que
 * mergea `<cwd>/.pi/settings.json` (project) con `~/.pi/agent/settings.json`
 * (global), project sobreescribiendo global. Replicamos esa misma lógica acá
 * para que xi liste exactamente las mismas sesiones que el usuario ve en `pi`.
 *
 * Formato de `session_info` (ver `appendSessionInfo` en session-manager.ts):
 *   {
 *     type: "session_info",
 *     id: <8 hex chars>,
 *     parentId: <id del último entry de la sesión, o null>,
 *     timestamp: <ISO 8601>,
 *     name: <nombre trimmed>
 *   }
 */

import { SettingsManager, SessionManager } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { readLeafId, getDefaultSessionDir } from "./sessions-helpers.ts";

/** Sesión serializada para el frontend (Date → timestamp ms). */
interface SessionInfoOutput {
	path: string;
	id: string;
	cwd: string;
	name?: string;
	parentSessionPath?: string;
	created: number;
	modified: number;
	messageCount: number;
	firstMessage: string;
}

const USAGE = `usage: pi-sessions <operation> [args...]

operations:
  list <cwd>                         List sessions for cwd
  delete <session-path>              Delete a session file
  rename <session-path> <new-name>   Rename a session (appends session_info entry)
`;

/** Imprime a stderr y exit con código != 0. */
function die(message: string, code = 1): never {
	console.error(message);
	process.exit(code);
}

/** Genera un ID de 8 hex chars, igual que `generateId` de pi. */
function shortId(): string {
	return randomUUID().slice(0, 8);
}

/**
 * Resuelve el `sessionDir` para un cwd replicando lo que hace el pi TUI.
 *
 * 1. `SettingsManager.create(cwd)` lee y mergea el settings del proyecto
 *    (`<cwd>/.pi/settings.json`) con el global (`~/.pi/agent/settings.json`).
 * 2. `getSessionDir()` retorna el `sessionDir` del merge, o `undefined` si
 *    no está configurado en ningún nivel.
 * 3. Si no está configurado, caemos al default del SDK:
 *    `~/.pi/agent/sessions/<encoded-cwd>/` (vía `getDefaultSessionDir`).
 * 4. Si está configurado pero es relativo (ej. `.pi/sessions`), lo resolvemos
 *    contra el cwd para que `SessionManager.list` reciba un path absoluto.
 */
function resolveSessionDir(cwd: string): string {
  // Auto-crear .pi/settings.json si no existe, para que las sesiones
  // queden dentro del proyecto (<cwd>/.pi/sessions/) en vez de usar
  // el default global (~/.pi/agent/sessions/<hash>/). Así el directorio
  // de sesiones es determinista y portable entre máquinas.
  const piDir = join(cwd, ".pi");
  const settingsPath = join(piDir, "settings.json");
  if (!existsSync(settingsPath)) {
    mkdirSync(piDir, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ sessionsDir: ".pi/sessions" }, null, 2) + "\n");
  }

  const sm = SettingsManager.create(cwd);
  const raw = sm.getSessionDir();
  if (!raw) return getDefaultSessionDir(cwd);
  if (!isAbsolute(raw)) return resolve(cwd, raw);
  return raw;
}

async function cmdList(cwd: string): Promise<void> {
	if (!cwd) die("list: missing argument: <cwd>");

	const sessionDir = resolveSessionDir(cwd);

	// Contar archivos JSONL antes de invocar SessionManager.list para
	// detectar archivos que el manager skipea silenciosamente
	// (corruptos, sin header válido, vacíos).
	let totalFiles = 0;
	try {
		if (existsSync(sessionDir)) {
			totalFiles = readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl")).length;
		}
	} catch {
		// Si falla el scan del directorio, no reportamos skipped —
		// probablemente el directorio no existe todavía (workspace sin
		// sesiones) o hay permisos. totalFiles queda en 0.
	}

	const sessions = await SessionManager.list(cwd, sessionDir);
	const skippedCount = totalFiles - sessions.length;

	const output: SessionInfoOutput[] = sessions.map((s) => ({
		path: s.path,
		id: s.id,
		cwd: s.cwd,
		...(s.name !== undefined ? { name: s.name } : {}),
		...(s.parentSessionPath !== undefined ? { parentSessionPath: s.parentSessionPath } : {}),
		created: s.created.getTime(),
		modified: s.modified.getTime(),
		messageCount: s.messageCount,
		firstMessage: s.firstMessage,
	}));

	const result: { sessions: SessionInfoOutput[]; skipped?: { count: number } } = {
		sessions: output,
	};

	if (skippedCount > 0) {
		result.skipped = { count: skippedCount };
	}

	console.log(JSON.stringify(result));
}

function cmdDelete(sessionPath: string): void {
	if (!sessionPath) die("delete: missing argument: <session-path>");
	if (!existsSync(sessionPath)) die(`delete: file not found: ${sessionPath}`);

	unlinkSync(sessionPath);
	console.log(JSON.stringify({ ok: true, deleted: sessionPath }));
}

function cmdRename(sessionPath: string, newName: string): void {
	if (!sessionPath) die("rename: missing argument: <session-path>");
	if (!newName) die("rename: missing argument: <new-name>");
	if (!existsSync(sessionPath)) die(`rename: file not found: ${sessionPath}`);

	// Leemos el JSONL actual. El nuevo entry session_info se vincula al último
	// entry de la conversación (parentId = leafId) para mantener la integridad
	// del árbol de entries que pi espera.
	const content = readFileSync(sessionPath, "utf-8");
	const lines = content.split("\n").filter((line) => line.trim());
	// lines.join("\n") evita que readLeafId divida content de nuevo —
	// el split ya se hizo arriba. readLeafId igual filtra líneas vacías
	// internamente, así que el resultado es idéntico.
	const parentId = readLeafId(lines.join("\n"));

	// Si readLeafId devuelve null, el archivo está vacío o corrupto.
	// En vez de crashear, el rename procede sin parentId — el entry
	// session_info queda huérfano (sin vínculo al árbol). La sesión
	// sigue funcionando, pero la UI no mostrará el nombre hasta que
	// se reconstruya el índice. Es mejor que un panic silencioso.
	if (parentId === null) {
		console.warn(`rename: ${sessionPath}: empty or corrupt JSONL, session_info will be orphaned`);
	}

	const sessionInfoEntry = JSON.stringify({
		type: "session_info",
		id: shortId(),
		parentId,
		timestamp: new Date().toISOString(),
		name: newName.trim(),
	});
	lines.push(sessionInfoEntry);

	writeFileSync(sessionPath, `${lines.join("\n")}\n`);

	console.log(JSON.stringify({ ok: true, path: sessionPath, name: newName.trim() }));
}

async function main(): Promise<void> {
	const [operation, ...args] = process.argv.slice(2);

	if (!operation) die(USAGE);

	switch (operation) {
		case "list":
			await cmdList(args[0] ?? "");
			return;
		case "delete":
			cmdDelete(args[0] ?? "");
			return;
		case "rename":
			cmdRename(args[0] ?? "", args[1] ?? "");
			return;
		default:
			die(`unknown operation: ${operation}\n\n${USAGE}`);
	}
}

main().catch((err) => {
	const message = err instanceof Error ? err.stack ?? err.message : String(err);
	console.error(message);
	process.exit(1);
});
