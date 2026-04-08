import { en } from './en';
import { zh } from './zh';
import type { Translations } from './en';

const translations: Record<string, Translations> = { en, zh };

export function getTranslations(lang: string): Translations {
  return translations[lang] ?? en;
}

export type { Translations };
