import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, isAbsolute } from "node:path";

// ─── Constantes ──────────────────────────────────────────────────────────────

/** Archivos que buscamos como contexto anidado. */
const CONTEXT_FILENAMES = ["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md"] as const;

/** Tools cuyas operaciones disparan la carga on-demand de contexto. */
const WATCHED_TOOLS = ["read", "write", "edit"] as const;

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface ContextEntry {
	/** Ruta absoluta del archivo de contexto cargado. */
	path: string;
	/** Contenido del archivo. */
	content: string;
}

// ─── Estado de sesión ────────────────────────────────────────────────────────

/**
 * Directorios cuyo contexto ya fue inyectado en esta sesión.
 * Almacenamos la ruta absoluta del directorio, no del archivo,
 * así cubrimos todos los context files de ese nivel.
 */
const loadedDirs = new Set<string>();

/** Contextos ya inyectados en esta sesión (para evitar duplicados). */
const loadedFiles = new Set<string>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extrae la ruta del archivo operado desde el input de la herramienta.
 * Para "read", "write", "edit": usan `input.path`.
 */
function extractFilePath(toolName: string, input: Record<string, unknown>): string | undefined {
	if (WATCHED_TOOLS.includes(toolName as typeof WATCHED_TOOLS[number])) {
		const p = input.path;
		if (typeof p === "string" && p.length > 0) return p;
	}
	return undefined;
}

/**
 * Resuelve una ruta a absoluta. Si ya es absoluta, la devuelve tal cual.
 * Si es relativa, la resuelve contra cwd.
 */
function resolvePath(maybeRelative: string, cwd: string): string {
	if (isAbsolute(maybeRelative)) return maybeRelative;
	return resolve(cwd, maybeRelative);
}

/**
 * Encuentra archivos de contexto en un directorio.
 * Busca AGENTS.md, CLAUDE.md, CLAUDE.local.md.
 * Retorna solo los que existen y no fueron cargados aún.
 */
function findContextFilesInDir(dir: string): ContextEntry[] {
	const entries: ContextEntry[] = [];

	for (const filename of CONTEXT_FILENAMES) {
		const fullPath = join(dir, filename);
		if (loadedFiles.has(fullPath)) continue;
		if (!existsSync(fullPath)) continue;

		try {
			const content = readFileSync(fullPath, "utf-8").trim();
			if (content.length === 0) continue;

			entries.push({ path: fullPath, content });
		} catch {
			// Permiso denegado, symlink roto, etc. → skip silencioso.
		}
	}

	return entries;
}

/**
 * Camina hacia arriba desde fileDir hasta projectRoot (exclusive).
 * projectRoot es el CWD — pi ya cargó su AGENTS.md al inicio.
 * Se detiene al llegar a projectRoot o a un directorio ya visitado.
 *
 * Retorna entradas en orden root→leaf (más general primero).
 */
function discoverContextWalk(fileDir: string, projectRoot: string): ContextEntry[] {
	const discovered: ContextEntry[] = [];
	let current = fileDir;
	let depth = 0;
	const MAX_DEPTH = 10;

	while (current !== projectRoot && current !== "/" && current !== "." && depth < MAX_DEPTH) {
		if (loadedDirs.has(current)) break;

		const entries = findContextFilesInDir(current);

		for (const entry of entries) {
			loadedFiles.add(entry.path);
		}

		if (entries.length > 0) {
			discovered.unshift(...entries);
		}

		loadedDirs.add(current);
		current = dirname(current);
		depth++;
	}

	return discovered;
}

/**
 * Construye el mensaje que se inyecta en la sesión.
 * Formato similar al de Claude Code: un bloque con prefijo claro
 * que el LLM pueda distinguir.
 */
function buildContextMessage(entries: ContextEntry[]): string {
	if (entries.length === 0) return "";

	const blocks = entries.map((entry) => {
		return `<!-- context: ${entry.path} -->\n${entry.content}`;
	});

	return `## Nested project context (loaded on demand)\n\n${blocks.join("\n\n---\n\n")}`;
}

// ─── Flush helpers ──────────────────────────────────────────────────────────

function flushCache(ctx?: { ui: { notify: (msg: string, level: string) => void } }) {
	loadedDirs.clear();
	loadedFiles.clear();
	ctx?.ui.notify("🧹 Nested context cache flushed — will reload AGENTS.md/CLAUDE.md on next read", "info");
}

// ─── Extension Hook ──────────────────────────────────────────────────────────

/**
 * Registra el hook de nested context en la API de pi.
 *
 * Escucha tool_result para read/write/edit. Cuando el LLM opera sobre
 * un archivo, camina hacia arriba desde el directorio del archivo
 * hasta el CWD buscando AGENTS.md/CLAUDE.md no cargados aún.
 * Los inyecta como contexto on-demand vía steer para que lleguen
 * en el mismo turno, antes del próximo LLM call.
 *
 * También maneja:
 * - Auto-flush en session_compact (los contextos inyectados se pierden al compactar)
 * - Comando /flush-context-files para flushear manualmente
 */
export function registerNestedContext(pi: ExtensionAPI) {
	// Limpiar estado al iniciar sesión
	pi.on("session_start", () => {
		loadedDirs.clear();
		loadedFiles.clear();
	});

	// Auto-flush en compact: los mensajes de contexto inyectados se pierden,
	// así que forzamos a rediscovery en el próximo read.
	pi.on("session_compact", () => {
		loadedDirs.clear();
		loadedFiles.clear();
	});

	// Comando manual para flushear (ej: /flush-context-files)
	pi.registerCommand("flush-context-files", {
		description: "Flush nested context cache so AGENTS.md/CLAUDE.md files are reloaded on next file read",
		handler: async (_args, ctx) => {
			flushCache(ctx);
		},
	});

	pi.on("tool_result", async (event, ctx) => {
		// Solo nos interesan las tools que operan sobre archivos
		if (!WATCHED_TOOLS.includes(event.toolName as typeof WATCHED_TOOLS[number])) return;
		// Solo cuando la operación fue exitosa (no error)
		if (event.isError) return;
		// Solo en modo interactivo (necesitamos sendMessage)
		if (!ctx.hasUI) return;

		const rawPath = extractFilePath(event.toolName, event.input as Record<string, unknown>);
		if (!rawPath) return;

		const absPath = resolvePath(rawPath, ctx.cwd);
		const fileDir = dirname(absPath);

		// Caminar hacia arriba desde el dir del archivo hasta el CWD (exclusive)
		const discovered = discoverContextWalk(fileDir, ctx.cwd);

		if (discovered.length === 0) return;

		const message = buildContextMessage(discovered);

		// Inyectar como steer: se procesa en este mismo turno, después
		// del tool_result actual, antes del próximo LLM call.
		pi.sendMessage(
			{
				customType: "xi-flow-context",
				content: message,
				display: true,
				details: {
					sourcePaths: discovered.map((e) => e.path),
				},
			},
			{ deliverAs: "steer" },
		);
	});
}
