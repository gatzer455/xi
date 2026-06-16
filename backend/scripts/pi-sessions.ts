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
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

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
 *    `~/.pi/agent/sessions/<encoded-cwd>/`.
 * 4. Si está configurado pero es relativo (ej. `.pi/sessions`), lo resolvemos
 *    contra el cwd para que `SessionManager.list` reciba un path absoluto.
 *
 * NOTA: `getDefaultSessionDir` no se exporta del index de pi, y bun --compile
 * no resuelve sub-paths no listados en `package.json#exports`. Replicamos la
 * función localmente. Si pi cambia la lógica del default, replicar acá.
 * Ver: dist/core/session-manager.js:220-225 en @earendil-works/pi-coding-agent.
 */
function getDefaultSessionDir(cwd: string): string {
	const resolvedCwd = resolve(cwd);
	const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(homedir(), ".pi", "agent", "sessions", safePath);
}

function resolveSessionDir(cwd: string): string {
	const sm = SettingsManager.create(cwd);
	const raw = sm.getSessionDir();
	if (!raw) return getDefaultSessionDir(cwd);
	if (!isAbsolute(raw)) return resolve(cwd, raw);
	return raw;
}

/** Lee el `id` del último entry del JSONL (el "leaf"), o null si está vacío. */
function readLeafId(jsonlContent: string): string | null {
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

async function cmdList(cwd: string): Promise<void> {
	if (!cwd) die("list: missing argument: <cwd>");

	const sessionDir = resolveSessionDir(cwd);
	const sessions = await SessionManager.list(cwd, sessionDir);
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

	console.log(JSON.stringify({ sessions: output }));
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
	const parentId = readLeafId(content);

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
