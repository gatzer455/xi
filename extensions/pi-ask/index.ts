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
// El schema define qué parámetros acepta el tool ask.
// Se mantiene idéntico al ask original para no romper compatibilidad con el LLM.

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
	// multi-select not yet supported by pi's UI API — planned for future
	recommended: Type.Optional(
		Type.Number({ description: "0-indexed recommended option. '(Recommended)' is shown automatically." }),
	),
});

const AskParamsSchema = Type.Object({
	questions: Type.Array(QuestionItemSchema, { description: "Questions to ask", minItems: 1 }),
});

type AskParams = Static<typeof AskParamsSchema>;

// ─── Result Types ─────────────────────────────────────────────────────────────
// Estos tipos definen qué devuelve el tool al LLM.
// QuestionResult es lo que el LLM recibe como "content".
// AskToolDetails es lo que se muestra en el historial de pi.

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
// Estas son las APIs de pi que usamos para interactuar con el usuario.
// Seleccionamos solo las que funcionan tanto en TUI como en RPC (xi).
// ctx.ui.custom() no funciona en RPC, por eso no la usamos.

type ExtensionUIContext = {
	select: (title: string, options: string[]) => Promise<string | undefined>;
	confirm: (title: string, message: string) => Promise<boolean>;
	input: (title: string, placeholder: string) => Promise<string | undefined>;
	editor: (title: string, prefill: string) => Promise<string | undefined>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Formatea una selección para el summary que el LLM recibe.
 *
 * El LLM necesita ver las respuestas en un formato claro y conciso.
 * Este función toma un QuestionResult y devuelve un string como:
 * - "cache" (selección simple)
 * - "[cache, redis]" (multi-selección)
 * - "redis cluster" (solo custom input)
 * - "cache + Other: redis cluster" (selección + custom)
 * - "(cancelled)" (sin respuesta)
 */
function formatSelectionForSummary(result: QuestionResult): string {
	const hasOptions = result.selectedOptions.length > 0;
	const hasCustom = Boolean(result.customInput);

	if (!hasOptions && !hasCustom) return "(cancelled)";
	if (hasOptions && hasCustom) {
		const selected = result.multi ? `[${result.selectedOptions.join(", ")}]` : result.selectedOptions[0];
		return `${selected} + Other: "${result.customInput}"`;
	}
	if (hasCustom) return `"${result.customInput}"`;
	if (result.multi) return `[${result.selectedOptions.join(", ")}]`;
	return result.selectedOptions[0];
}

/**
 * Formatea las líneas de respuesta para un question result.
 *
 * Separa la lógica de formato para mantener buildAskSessionContent limpio.
 * Devuelve texto indentado como:
 * - "  Selected: cache"
 * - "  Selected: [cache, redis]"
 * - "  Selected: Other (type your own)"
 * - "  Custom input: redis cluster"
 */
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

/**
 * Construye el content final que el LLM recibe como respuesta.
 *
 * El formato tiene dos partes:
 * 1. User answers: resumen conciso de todas las respuestas
 * 2. Answer context: detalle de cada pregunta con su respuesta
 *
 * Las notas (notes) se agregan al final de ambas partes para que el LLM
 * las vea como contexto adicional que puede usar en su razonamiento.
 */
function buildAskSessionContent(results: QuestionResult[], notes?: string): string {
	const summaryLines = results.map((r) => `${r.id}: ${formatSelectionForSummary(r)}`);

	if (notes) {
		summaryLines.push(`\nNotes: ${notes}`);
	}

	const contextBlocks = results.map((result, index) => {
		const lines: string[] = [`Question ${index + 1} (${result.id})`, `Prompt: ${result.question}`];

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

/**
 * Maneja una pregunta simple: muestra las opciones y captura la selección.
 *
 * Flujo:
 * 1. Construye la lista de opciones con appendRecommendedTagToOptionLabels()
 * 2. Agrega "Other (type your own)" al final
 * 3. Muestra ctx.ui.select() al usuario
 * 4. Si elige "Other" → llama a handleOtherInput()
 * 5. Si elige una opción normal → retorna buildSingleSelectionResult()
 * 6. Si cancela (Escape) → retorna selección vacía
 */
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

/**
 * Maneja la opción "Other" — pide al usuario que escriba su respuesta.
 *
 * Esta función separa la lógica de "Other" para mantener handleSingleQuestion limpio.
 * Si el usuario cancela o escribe vacío, retorna selección vacía.
 */
async function handleOtherInput(ui: ExtensionUIContext): Promise<AskSelection> {
	const customInput = await ui.input("Type your answer:", "");
	if (customInput === undefined || customInput.trim().length === 0) {
		return { selectedOptions: [] };
	}
	return { selectedOptions: [], customInput: customInput.trim() };
}

// ─── Multi Question ───────────────────────────────────────────────────────────

/**
 * Resultado del multi-question: las selecciones de cada pregunta + notas opcionales.
 *
 * Las notas son un string libre que el usuario puede agregar después de responder
 * todas las preguntas. Sirven para dar contexto adicional o matices que las
 * opciones predefinidas no capturan.
 */
interface MultiQuestionResult {
	selections: AskSelection[];
	notes?: string;
}

/**
 * Maneja N preguntas: una por cada question + notas opcionales al final.
 *
 * Flujo:
 * 1. Para cada pregunta, ejecuta handleSingleQuestion()
 * 2. Si hay más de 1 pregunta, pregunta si quiere agregar notas
 * 3. Retorna las selecciones + las notas (si existen)
 *
 * Las notas solo se preguntan si hay más de 1 pregunta porque:
 * - En single question, el usuario ya puede usar "Other" para notas
 * - En multi question, "Other" es por pregunta, no global
 */
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

/**
 * Pregunta si el usuario quiere agregar notas y las captura.
 *
 * Usa dos APIs simples en secuencia:
 * 1. ctx.ui.confirm() — pregunta sí/no
 * 2. ctx.ui.input() — captura el texto de las notas
 *
 * Esta secuencia reemplaza al editor de review del ask original.
 * El usuario puede agregar matices, aclaraciones o contexto adicional
 * que las opciones predefinidas no cubren.
 */
async function handleOptionalNotes(ui: ExtensionUIContext): Promise<string | undefined> {
	const wantsNotes = await ui.confirm("Add notes?", "Do you want to add any notes or comments?");
	if (!wantsNotes) return undefined;

	const notes = await ui.input("Your notes:", "Type your notes here...");
	return notes?.trim() || undefined;
}

// ─── Tool Registration ────────────────────────────────────────────────────────

const ASK_TOOL_DESCRIPTION = `
Ask the user for clarification when a choice materially affects the outcome.

- Use when multiple valid approaches have different trade-offs.
- Prefer 2-5 concise options.
- Use recommended=<index> (0-indexed) to mark the default option.
- Use description to provide Markdown/plain context (supports long explanations and structure diagrams).
- You can ask multiple related questions in one call using questions[].
- Do NOT include an 'Other' option; UI adds it automatically.
- Note: multi-select (multi: true) is planned for a future version.
`.trim();

export default function askExtension(pi: ExtensionAPI) {
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

			// Route: single vs multi question
			// En single, no preguntamos por notas porque el usuario puede usar "Other"
			const isSingle = params.questions.length === 1;
			const { selections, notes } = isSingle
				? { selections: [await handleSingleQuestion(ctx.ui, params.questions[0])], notes: undefined }
				: await handleMultiQuestion(ctx.ui, params.questions);

			// Build results
			const results: QuestionResult[] = params.questions.map((q, i) => ({
				id: q.id,
				question: q.question,
				...(q.description && q.description.trim().length > 0 ? { description: q.description } : {}),
				options: q.options.map((o) => o.label),
				multi: q.multi ?? false,
				selectedOptions: selections[i].selectedOptions,
				customInput: selections[i].customInput,
			}));

			// Build details (single question shorthand for backward compat)
			// El formato details es diferente para single vs multi por compatibilidad
			// con el ask original. En single, los campos van al nivel raíz.
			// En multi, van dentro de un array "results".
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

/**
 * Construye details para single question (formato heredado).
 *
 * El ask original tiene un formato donde los campos de la pregunta
 * van al nivel raíz del details object. Este formato se mantiene
 * para no romper compatibilidad con clientes que esperen esa estructura.
 */
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
