export const OTHER_OPTION = "Other (type your own)";
const RECOMMENDED_OPTION_TAG = " (Recommended)";

export interface AskOption {
	label: string;
}

export interface AskQuestion {
	id: string;
	question: string;
	description?: string;
	options: AskOption[];
	multi?: boolean;
	recommended?: number;
}

export interface AskSelection {
	selectedOptions: string[];
	customInput?: string;
}

export function appendRecommendedTagToOptionLabels(
	optionLabels: string[],
	recommendedOptionIndex?: number,
): string[] {
	if (
		recommendedOptionIndex == null ||
		recommendedOptionIndex < 0 ||
		recommendedOptionIndex >= optionLabels.length
	) {
		return optionLabels;
	}

	return optionLabels.map((optionLabel, optionIndex) => {
		if (optionIndex !== recommendedOptionIndex) return optionLabel;
		if (optionLabel.endsWith(RECOMMENDED_OPTION_TAG)) return optionLabel;
		return `${optionLabel}${RECOMMENDED_OPTION_TAG}`;
	});
}

function removeRecommendedTagFromOptionLabel(optionLabel: string): string {
	if (!optionLabel.endsWith(RECOMMENDED_OPTION_TAG)) {
		return optionLabel;
	}
	return optionLabel.slice(0, -RECOMMENDED_OPTION_TAG.length);
}

export function buildSingleSelectionResult(selectedOptionLabel: string, note?: string): AskSelection {
	const normalizedSelectedOption = removeRecommendedTagFromOptionLabel(selectedOptionLabel);
	const normalizedNote = note?.trim();

	if (normalizedSelectedOption === OTHER_OPTION) {
		if (normalizedNote) {
			return { selectedOptions: [], customInput: normalizedNote };
		}
		return { selectedOptions: [] };
	}

	if (normalizedNote) {
		return { selectedOptions: [`${normalizedSelectedOption} - ${normalizedNote}`] };
	}

	return { selectedOptions: [normalizedSelectedOption] };
}

// ponytail: buildMultiSelectionResult removed — multi-select no implementado.
// Agregar cuando ask tool soporte multi: true (ver ask.ts línea 237).
