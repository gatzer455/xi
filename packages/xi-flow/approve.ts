import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ApproveRules {
	rules: Record<string, string[]>;
	messages?: Record<string, string>;
}

interface ApproveConfig {
	rules: Record<string, string[]>;
	messages: Record<string, string>;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_RULES: Record<string, string[]> = {
	bash: ["rm -rf", "sudo", "chmod 777", "shutdown", "reboot", "mkfs", "dd if=", "> /dev/sda", "git push --force", "git reset --hard"],
	write: [".env", "credentials", "secrets", "id_rsa", ".pem"],
	edit: [".env", "credentials", "secrets", "id_rsa", ".pem"],
};

const DEFAULT_MESSAGES: Record<string, string> = {
	bash: "⚠️ Confirm before running this command",
	write: "⚠️ Confirm before writing to this file",
	edit: "⚠️ Confirm before editing this file",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadRules(cwd: string): ApproveConfig {
	let rules: Record<string, string[]> = { ...DEFAULT_RULES };
	let messages: Record<string, string> = { ...DEFAULT_MESSAGES };

	// Global: ~/.pi/agent/approve-rules.json
	const globalPath = join(homedir(), ".pi", "agent", "approve-rules.json");
	const globalConfig = readConfigFile(globalPath);
	if (globalConfig) {
		rules = mergeRules(rules, globalConfig.rules);
		messages = { ...messages, ...globalConfig.messages };
	}

	// Proyecto: .pi/approve-rules.json
	const projectPath = join(cwd, ".pi", "approve-rules.json");
	const projectConfig = readConfigFile(projectPath);
	if (projectConfig) {
		rules = mergeRules(rules, projectConfig.rules);
		messages = { ...messages, ...projectConfig.messages };
	}

	return { rules, messages };
}

function mergeRules(
	base: Record<string, string[]>,
	overlay: Record<string, string[]> | undefined,
): Record<string, string[]> {
	if (!overlay) return { ...base };
	const result = { ...base };
	for (const [key, values] of Object.entries(overlay)) {
		if (result[key]) {
			result[key] = [...new Set([...result[key], ...values])];
		} else {
			result[key] = [...values];
		}
	}
	return result;
}

function readConfigFile(path: string): ApproveRules | null {
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf-8");
		return JSON.parse(raw) as ApproveRules;
	} catch (err) {
		console.warn(`[xi-flow] Failed to parse ${path}:`, err);
		return null;
	}
}

function matchesRule(input: string, rules: string[]): boolean {
	if (rules.includes("*")) return true;
	return rules.some((rule) => input.includes(rule));
}

function getInputToCheck(toolName: string, input: Record<string, unknown>): string | undefined {
	if (toolName === "bash") {
		return typeof input.command === "string" ? input.command : undefined;
	}
	if (toolName === "write" || toolName === "edit") {
		return typeof input.path === "string" ? input.path : undefined;
	}
	return undefined;
}

async function handleApproval(
	ui: { select: (title: string, options: string[]) => Promise<string | undefined> },
	message: string,
	input: string,
): Promise<"yes" | "always" | "no"> {
	const title = `${message}:\n\n  ${input}`;
	const choice = await ui.select(title, [
		"Yes, allow once",
		"Yes, allow for this session",
		"No, block",
	]);

	if (choice === "Yes, allow once") return "yes";
	if (choice === "Yes, allow for this session") return "always";
	return "no";
}

// ─── Extension Hook ──────────────────────────────────────────────────────────

export function registerApprove(pi: ExtensionAPI) {
	const alwaysAllowed = new Map<string, Set<string>>();

	pi.on("session_start", () => {
		alwaysAllowed.clear();
	});

	pi.on("tool_call", async (event, ctx) => {
		const toolName = event.toolName;

		if (!ctx.hasUI) {
			return { block: true, reason: "Approval required but no UI available" };
		}

		const config = loadRules(ctx.cwd);

		const rules = config.rules[toolName];
		if (!rules || rules.length === 0) return undefined;

		const inputToCheck = getInputToCheck(toolName, event.input as Record<string, unknown>);
		if (!inputToCheck) return undefined;

		if (!matchesRule(inputToCheck, rules)) return undefined;

		// ¿Ya está en always-allowed para esta sesión?
		const allowed = alwaysAllowed.get(toolName);
		if (allowed?.has(inputToCheck)) return undefined;

		const message = config.messages[toolName] ?? "⚠️ Action requires approval";
		const decision = await handleApproval(ctx.ui, message, inputToCheck);

		if (decision === "always") {
			if (!alwaysAllowed.has(toolName)) {
				alwaysAllowed.set(toolName, new Set());
			}
			alwaysAllowed.get(toolName)!.add(inputToCheck);
			return undefined;
		}

		if (decision === "yes") return undefined;

		return { block: true, reason: `Blocked by user: ${inputToCheck}` };
	});
}
