import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApproveRules {
	rules: Record<string, string[]>;
	messages?: Record<string, string>;
}

interface ApproveConfig {
	rules: Record<string, string[]>;
	messages: Record<string, string>;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────
// Reglas por defecto cuando no hay archivo de config.
// Se eligen patrones comunes que los usuarios no-técnicos no deberían ejecutar sin pensar.

const DEFAULT_RULES: Record<string, string[]> = {
	bash: ["rm -rf", "sudo", "chmod 777", "shutdown", "reboot"],
	write: [".env", "credentials", "secrets"],
	edit: [".env", "credentials", "secrets"],
};

const DEFAULT_MESSAGES: Record<string, string> = {
	bash: "Confirm before running this command",
	write: "Confirm before writing to this file",
	edit: "Confirm before editing this file",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Carga las reglas siguiendo la jerarquía de pi:
 * 1. Defaults (hardcoded)
 * 2. ~/.pi/agent/approve-rules.json (global)
 * 3. {cwd}/.pi/approve-rules.json (proyecto, override)
 *
 * Los objetos se mergean, pero los arrays se concatenan.
 * Si un archivo tiene errores, se ignora y se usa lo que ya se cargó.
 */
function loadRules(cwd: string): ApproveConfig {
	let rules: Record<string, string[]> = { ...DEFAULT_RULES };
	let messages: Record<string, string> = { ...DEFAULT_MESSAGES };

	// Cargar global
	const globalPath = join(homedir(), ".pi", "agent", "approve-rules.json");
	const globalConfig = readConfigFile(globalPath);
	if (globalConfig) {
		rules = mergeRules(rules, globalConfig.rules);
		messages = { ...messages, ...globalConfig.messages };
	}

	// Cargar proyecto (concatena arrays)
	const projectPath = join(cwd, ".pi", "approve-rules.json");
	const projectConfig = readConfigFile(projectPath);
	if (projectConfig) {
		rules = mergeRules(rules, projectConfig.rules);
		messages = { ...messages, ...projectConfig.messages };
	}

	return { rules, messages };
}

/**
 * Mergea reglas: los objetos se mergean, los arrays se concatenan.
 * Ejemplo:
 *   base:  { bash: ["rm -rf"], write: [".env"] }
 *   overlay: { bash: ["kill"] }
 *   result: { bash: ["rm -rf", "kill"], write: [".env"] }
 */
function mergeRules(
	base: Record<string, string[]>,
	overlay: Record<string, string[]> | undefined,
): Record<string, string[]> {
	if (!overlay) return { ...base };

	const result = { ...base };
	for (const [key, values] of Object.entries(overlay)) {
		if (result[key]) {
			// Concatenar y deduplicar
			result[key] = [...new Set([...result[key], ...values])];
		} else {
			result[key] = [...values];
		}
	}
	return result;
}

/** Lee un archivo de config. Retorna null si no existe o tiene errores. */
function readConfigFile(path: string): ApproveRules | null {
	if (!existsSync(path)) return null;

	try {
		const raw = readFileSync(path, "utf-8");
		return JSON.parse(raw) as ApproveRules;
	} catch (err) {
		console.warn(`[pi-approve] Failed to parse ${path}:`, err);
		return null;
	}
}

/**
 * Verifica si un input (comando o ruta) matchea alguna regla.
 *
 * Patrones soportados:
 * - "rm -rf" → matchea si el input contiene "rm -rf"
 * - ["*"] → siempre preguntar
 * - [] o no incluido → nunca preguntar
 */
function matchesRule(input: string, rules: string[]): boolean {
	if (rules.includes("*")) return true;
	return rules.some((rule) => input.includes(rule));
}

/**
 * Extrae el texto relevante del input según la herramienta.
 *
 * Para bash, extrae el command.
 * Para write/edit, extrae la path.
 * Si no se puede extraer, retorna undefined.
 */
function getInputToCheck(toolName: string, input: Record<string, unknown>): string | undefined {
	if (toolName === "bash") {
		return typeof input.command === "string" ? input.command : undefined;
	}

	if (toolName === "write" || toolName === "edit") {
		return typeof input.path === "string" ? input.path : undefined;
	}

	return undefined;
}

/**
 * Muestra UI de confirmación al usuario.
 *
 * El formato muestra:
 * 1. El mensaje de contexto (qué se va a hacer)
 * 2. El comando o ruta exacta
 * 3. Las opciones de decisión
 *
 * Retorna:
 * - "yes" → permitir una vez
 * - "always" → agregar a always-allowed y permitir
 * - "no" → bloquear
 * - undefined (escape) → bloquear
 */
async function handleApproval(
	ui: { select: (title: string, options: string[]) => Promise<string | undefined> },
	message: string,
	input: string,
): Promise<"yes" | "always" | "no"> {
	const title = `${message}:\n\n  ${input}`;
	const choice = await ui.select(title, ["Yes, allow once", "Yes, allow for this session", "No, block"]);

	if (choice === "Yes, allow once") return "yes";
	if (choice === "Yes, allow for this session") return "always";
	return "no";
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function approveExtension(pi: ExtensionAPI) {
	// "Always" se guarda en memoria: Map<toolName, Set<pattern>>
	// Se resetea al inicio de cada sesión (el Map se crea nuevo acá)
	const alwaysAllowed = new Map<string, Set<string>>();

	pi.on("session_start", () => {
		alwaysAllowed.clear();
	});

	pi.on("tool_call", async (event, ctx) => {
		const toolName = event.toolName;

		// Guard: no hay UI disponible — block by default
		if (!ctx.hasUI) {
			return { block: true, reason: "Approval required but no UI available" };
		}

		// Cargar config (se carga en cada tool_call para respetar cambios en caliente)
		// Jerarquía: defaults → global (~/.pi/agent/) → proyecto (.pi/)
		const config = loadRules(ctx.cwd);

		// Guard: no hay reglas para esta herramienta
		const rules = config.rules[toolName];
		if (!rules || rules.length === 0) {
			return undefined;
		}

		// Extraer el input relevante
		const inputToCheck = getInputToCheck(toolName, event.input as Record<string, unknown>);
		if (!inputToCheck) {
			return undefined;
		}

		// Guard: el input no matchea ninguna regla
		if (!matchesRule(inputToCheck, rules)) {
			return undefined;
		}

		// Guard: ya está en always-allowed
		const allowed = alwaysAllowed.get(toolName);
		if (allowed?.has(inputToCheck)) {
			return undefined;
		}

		// Preguntar al usuario
		const message = config.messages[toolName] ?? "⚠️ Action requires approval";
		const decision = await handleApproval(ctx.ui, message, inputToCheck);

		if (decision === "always") {
			// Agregar a always-allowed para esta sesión
			if (!alwaysAllowed.has(toolName)) {
				alwaysAllowed.set(toolName, new Set());
			}
			alwaysAllowed.get(toolName)!.add(inputToCheck);
			return undefined; // permitir
		}

		if (decision === "yes") {
			return undefined; // permitir una vez
		}

		// "no" o escape
		return { block: true, reason: `Blocked by user: ${inputToCheck}` };
	});
}
