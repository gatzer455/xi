import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
	OTHER_OPTION,
	appendRecommendedTagToOptionLabels,
	buildSingleSelectionResult,
	type AskQuestion,
	type AskSelection,
} from "./ask-logic";

// ─── Schema ───────────────────────────────────────────────────────────────────

const OptionItemSchema = Type.Object({
	label: Type.String({ description: "Display label" }),
});

const QuestionItemSchema = Type.Object({
	id: Type.String({ description: "Question id (e.g. auth, cache, priority)" }),
	question: Type.String({ description: "Question text" }),
	description: Type.Optional(
		Type.String({
			description:
				"Optional context in Markdown/plain text. Rendered above options with wrapping (supports headings/lists/code blocks).",
		}),
	),
	options: Type.Array(OptionItemSchema, {
		description: "Available options. Do not include 'Other'.",
		minItems: 1,
	}),
	recommended: Type.Optional(
		Type.Number({ description: "0-indexed recommended option. '(Recommended)' is shown automatically." }),
	),
});

const AskParamsSchema = Type.Object({
	questions: Type.Array(QuestionItemSchema, { description: "Questions to ask", minItems: 1 }),
});

type AskParams = Static<typeof AskParamsSchema>;

// ─── Result Types ─────────────────────────────────────────────────────────────

interface QuestionResult {
	id: string;
	question: string;
	description?: string;
	options: string[];
	multi: boolean;
	selectedOptions: string[];
	customInput?: string;
}

interface AskToolDetails {
	id?: string;
	question?: string;
	description?: string;
	options?: string[];
	multi?: boolean;
	selectedOptions?: string[];
	customInput?: string;
	results?: QuestionResult[];
}

// ─── UI Context Type ──────────────────────────────────────────────────────────

type ExtensionUIContext = {
	select: (title: string, options: string[]) => Promise<string | undefined>;
	confirm: (title: string, message: string) => Promise<boolean>;
	input: (title: string, placeholder: string) => Promise<string | undefined>;
	editor: (title: string, prefill: string) => Promise<string | undefined>;
};

// ─── Formatting Helpers ───────────────────────────────────────────────────────

function formatSelectionForSummary(result: QuestionResult): string {
	const hasOptions = result.selectedOptions.length > 0;
	const hasCustom = Boolean(result.customInput);

	if (!hasOptions && !hasCustom) return "(cancelled)";
	if (hasOptions && hasCustom) {
		const selected = result.multi
			? `[${result.selectedOptions.join(", ")}]`
			: result.selectedOptions[0];
		return `${selected} + Other: "${result.customInput}"`;
	}
	if (hasCustom) return `"${result.customInput}"`;
	if (result.multi) return `[${result.selectedOptions.join(", ")}]`;
	return result.selectedOptions[0];
}

function formatResponseLines(result: QuestionResult): string {
	if (result.selectedOptions.length === 0 && !result.customInput) {
		return "  Selected: (cancelled)";
	}

	const lines: string[] = [];

	if (result.selectedOptions.length > 0) {
		const selectedText = result.multi
			? `[${result.selectedOptions.join(", ")}]`
			: result.selectedOptions[0];
		lines.push(`  Selected: ${selectedText}`);
	}

	if (result.customInput) {
		if (result.selectedOptions.length === 0) {
			lines.push(`  Selected: ${OTHER_OPTION}`);
		}
		lines.push(`  Custom input: ${result.customInput}`);
	}

	return lines.join("\n");
}

function buildAskSessionContent(results: QuestionResult[], notes?: string): string {
	const summaryLines = results.map((r) => `${r.id}: ${formatSelectionForSummary(r)}`);

	if (notes) {
		summaryLines.push(`\nNotes: ${notes}`);
	}

	const contextBlocks = results.map((result, index) => {
		const lines: string[] = [
			`Question ${index + 1} (${result.id})`,
			`Prompt: ${result.question}`,
		];

		if (result.description) {
			lines.push("Context:");
			for (const descriptionLine of result.description.split("\n")) {
				lines.push(`  ${descriptionLine}`);
			}
		}

		lines.push("Options:");
		lines.push(...result.options.map((option, i) => `  ${i + 1}. ${option}`));
		lines.push("Response:");
		lines.push(formatResponseLines(result));

		return lines.join("\n");
	});

	if (notes) {
		contextBlocks.push(`Notes: ${notes}`);
	}

	return `User answers:\n${summaryLines.join("\n")}\n\nAnswer context:\n${contextBlocks.join("\n\n")}`;
}

// ─── Single Question ──────────────────────────────────────────────────────────

async function handleSingleQuestion(
	ui: ExtensionUIContext,
	question: AskQuestion,
): Promise<AskSelection> {
	const baseOptionLabels = question.options.map((o) => o.label);
	const optionLabels = appendRecommendedTagToOptionLabels(baseOptionLabels, question.recommended);
	const optionsWithOther = [...optionLabels, OTHER_OPTION];

	const prompt = question.description
		? `${question.question}\n\n${question.description}`
		: question.question;

	const selected = await ui.select(prompt, optionsWithOther);
	if (selected === undefined) return { selectedOptions: [] };

	if (selected === OTHER_OPTION) {
		return handleOtherInput(ui);
	}

	return buildSingleSelectionResult(selected);
}

async function handleOtherInput(ui: ExtensionUIContext): Promise<AskSelection> {
	const customInput = await ui.input("Type your answer:", "");
	if (customInput === undefined || customInput.trim().length === 0) {
		return { selectedOptions: [] };
	}
	return { selectedOptions: [], customInput: customInput.trim() };
}

// ─── Multi Question ───────────────────────────────────────────────────────────

interface MultiQuestionResult {
	selections: AskSelection[];
	notes?: string;
}

async function handleMultiQuestion(
	ui: ExtensionUIContext,
	questions: AskQuestion[],
): Promise<MultiQuestionResult> {
	const selections: AskSelection[] = [];

	for (const question of questions) {
		const selection = await handleSingleQuestion(ui, question);
		selections.push(selection);
	}

	const notes = questions.length > 1 ? await handleOptionalNotes(ui) : undefined;

	return { selections, notes };
}

async function handleOptionalNotes(ui: ExtensionUIContext): Promise<string | undefined> {
	const wantsNotes = await ui.confirm("Add notes?", "Do you want to add any notes or comments?");
	if (!wantsNotes) return undefined;

	const notes = await ui.input("Your notes:", "Type your notes here...");
	return notes?.trim() || undefined;
}

// ─── Details Builder ──────────────────────────────────────────────────────────

function buildSingleDetails(result: QuestionResult): AskToolDetails {
	return {
		id: result.id,
		question: result.question,
		...(result.description ? { description: result.description } : {}),
		options: result.options,
		multi: result.multi,
		selectedOptions: result.selectedOptions,
		customInput: result.customInput,
		results: [result],
	};
}

// ─── Tool Registration ────────────────────────────────────────────────────────

const ASK_TOOL_DESCRIPTION = `
Ask the user for clarification when a choice materially affects the outcome.

- Use when multiple valid approaches have different trade-offs.
- Prefer 2-5 concise options.
- Use recommended=<index> (0-indexed) to mark the default option.
- Use description to provide Markdown/plain context (supports long explanations and structure diagrams).
- Note: multi-select (multi: true) is planned for a future version.
- You can ask multiple related questions in one call using questions[].
- Do NOT include an 'Other' option; UI adds it automatically.
`.trim();

export function registerAsk(pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask",
		label: "Ask",
		description: ASK_TOOL_DESCRIPTION,
		parameters: AskParamsSchema,

		async execute(_toolCallId, params: AskParams, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: "Error: ask tool requires interactive mode" }],
					details: {},
				};
			}

			if (params.questions.length === 0) {
				return {
					content: [{ type: "text", text: "Error: questions must not be empty" }],
					details: {},
				};
			}

			const isSingle = params.questions.length === 1;
			const { selections, notes } = isSingle
				? {
						selections: [await handleSingleQuestion(ctx.ui, params.questions[0])],
						notes: undefined,
					}
				: await handleMultiQuestion(ctx.ui, params.questions);

			const results: QuestionResult[] = params.questions.map((q, i) => ({
				id: q.id,
				question: q.question,
				...(q.description && q.description.trim().length > 0
					? { description: q.description }
					: {}),
				options: q.options.map((o) => o.label),
				multi: q.multi ?? false,
				selectedOptions: selections[i].selectedOptions,
				customInput: selections[i].customInput,
			}));

			const details: AskToolDetails = isSingle
				? buildSingleDetails(results[0])
				: { results };

			return {
				content: [{ type: "text", text: buildAskSessionContent(results, notes) }],
				details,
			};
		},
	});
}
