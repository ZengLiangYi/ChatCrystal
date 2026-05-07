export const LANGUAGE_OPTIONS = ["zh", "en"] as const;

export type LanguageOptionCode = (typeof LANGUAGE_OPTIONS)[number];

export function getSelectedLanguageCode(
	language: string | undefined,
): LanguageOptionCode | undefined {
	const baseLanguage = language?.split(/[-_]/, 1)[0]?.toLowerCase();
	return LANGUAGE_OPTIONS.find((code) => baseLanguage === code);
}
