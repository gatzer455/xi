import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// ─── Config ──────────────────────────────────────────────────────────────────

/** Archivo de config: ~/.pi/agent/xi-flow/mentions.json → { "trigger": "¬" } */
const CONFIG_PATH = join(homedir(), ".pi", "agent", "xi-flow", "mentions.json");
const DEFAULT_TRIGGER = "¬";

function loadTrigger(): string {
	if (!existsSync(CONFIG_PATH)) return DEFAULT_TRIGGER;
	try {
		const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as { trigger?: string };
		if (cfg.trigger && cfg.trigger.trim().length > 0 && cfg.trigger !== "/") {
			return cfg.trigger;
		}
	} catch {
		// Config inválida → default
	}
	return DEFAULT_TRIGGER;
}

// ─── Parser puro (testeable, sin IO) ─────────────────────────────────────────

export interface SkillRef {
	name: string;
	path: string;
	baseDir: string;
	description?: string;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionPattern(trigger: string): RegExp {
	// Nombres de skill: lowercase, dígitos y guiones (spec de Agent Skills)
	return new RegExp(escapeRegex(trigger) + "([a-z0-9][a-z0-9-]*)", "g");
}

/** Encuentra menciones trigger+nombre en el texto. No valida que existan. */
export function findMentions(text: string, trigger: string): { token: string; name: string }[] {
	const found: { token: string; name: string }[] = [];
	for (const m of text.matchAll(mentionPattern(trigger))) {
		found.push({ token: m[0], name: m[1] });
	}
	return found;
}

export function stripFrontmatter(content: string): string {
	return content.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

/** Bloque <skill> idéntico al que produce /skill:nombre nativo en pi. */
export function buildSkillBlock(name: string, skill: SkillRef, body: string): string {
	const clean = stripFrontmatter(body).trim();
	return `<skill name="${name}" location="${skill.path}">\nReferences are relative to ${skill.baseDir}.\n\n${clean}\n</skill>`;
}

/** Resuelve las menciones conocidas y separa los bloques del texto del usuario. */
function resolveMentions(
	text: string,
	trigger: string,
	skills: Map<string, SkillRef>,
	readBody: (path: string) => string,
): { userText: string; blocks: string[] } {
	const blocks: string[] = [];
	const userText = text.replace(mentionPattern(trigger), (token, name: string) => {
		const skill = skills.get(name);
		if (!skill) return token;
		blocks.push(buildSkillBlock(name, skill, readBody(skill.path)));
		return token; // la mención queda inline como referencia visible
	});
	return { userText: userText.trim(), blocks };
}

/**
 * Expande skills y deja el texto del usuario aparte, conservando las menciones
 * inline (¬nombre) como referencia visible. Desconocidas quedan como texto.
 */
export function expandMentions(
	text: string,
	trigger: string,
	skills: Map<string, SkillRef>,
	readBody: (path: string) => string,
): string {
	const { userText, blocks } = resolveMentions(text, trigger, skills, readBody);
	if (blocks.length === 0) return text;
	return blocks.join("\n\n") + (userText ? `\n\n${userText}` : "");
}

// ─── Extension Hook ──────────────────────────────────────────────────────────

/** Skills cargados por pi (respeta trust, settings, packages y CLI). */
function collectSkills(pi: ExtensionAPI): Map<string, SkillRef> {
	const map = new Map<string, SkillRef>();
	for (const cmd of pi.getCommands()) {
		if (cmd.source !== "skill") continue;
		const name = cmd.name.replace(/^skill:/, "");
		map.set(name, {
			name,
			path: cmd.sourceInfo.path,
			baseDir: cmd.sourceInfo.baseDir ?? dirname(cmd.sourceInfo.path),
			description: cmd.description,
		});
	}
	return map;
}

export function registerMentions(pi: ExtensionAPI) {
	pi.registerMessageRenderer("skill", (message, { expanded, outputPad }, theme) => {
		if (typeof message.content !== "string") return;
		const match = message.content.match(
			/^<skill name="([^"]+)" location="[^"]+">\n[\s\S]*?\n\n([\s\S]*)\n<\/skill>$/,
		);
		if (!match) return;

		const label = theme.fg("customMessageLabel", "[skill]") +
			" " + theme.fg("customMessageText", match[1]);
		const box = new Box(outputPad, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(expanded ? `${label}\n${match[2]}` : label, 0, 0));
		return box;
	});

	pi.on("input", async (event) => {
		if (event.source === "extension") return { action: "continue" };

		const trigger = loadTrigger();
		const { userText, blocks } = resolveMentions(
			event.text,
			trigger,
			collectSkills(pi),
			(p) => readFileSync(p, "utf-8"),
		);
		if (blocks.length === 0) return { action: "continue" };

		const delivery = event.streamingBehavior ? { deliverAs: event.streamingBehavior } : undefined;
		for (const content of blocks) {
			pi.sendMessage({ customType: "skill", content, display: true }, delivery);
		}
		if (!userText && !event.images?.length) return { action: "handled" };
		const content = event.images?.length
			? [{ type: "text" as const, text: userText }, ...event.images]
			: userText;
		pi.sendUserMessage(content, delivery);
		return { action: "handled" };
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		const trigger = loadTrigger();
		ctx.ui.addAutocompleteProvider((current) => ({
			triggerCharacters: [trigger],
			async getSuggestions(lines, cursorLine, cursorCol, options) {
				const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
				const match = beforeCursor.match(
					new RegExp("(?:^|[ \\t])" + escapeRegex(trigger) + "([a-z0-9-]*)$"),
				);
				if (!match) {
					return current.getSuggestions(lines, cursorLine, cursorCol, options);
				}

				const prefix = match[1] ?? "";
				const items = [...collectSkills(pi)]
					.filter(([, skill]) => skill.name.startsWith(prefix))
					.map(([, skill]) => ({
						value: `${trigger}${skill.name}`,
						label: skill.name,
						description: skill.description,
					}));
				if (items.length === 0) {
					return current.getSuggestions(lines, cursorLine, cursorCol, options);
				}

				return { prefix: `${trigger}${prefix}`, items };
			},
			applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			},
			shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
				return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
			},
		}));
	});
}

