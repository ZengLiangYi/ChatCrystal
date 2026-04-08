import { zh, type Locale } from './zh.js';
import { en } from './en.js';

const locales: Record<string, Locale> = { zh, en };

let currentLocale: Locale | null = null;

/**
 * Detect locale from: config arg > LANG env var > default 'en'.
 * Call once at app startup; subsequent calls return cached value.
 */
export function getLocale(configLocale?: string): Locale {
  if (currentLocale) return currentLocale;

  let lang = configLocale;

  if (!lang) {
    // Check LANG env: "zh_CN.UTF-8" → "zh", "en_US.UTF-8" → "en"
    const envLang = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || '';
    lang = envLang.slice(0, 2).toLowerCase();
  }

  currentLocale = locales[lang!] ?? en;
  return currentLocale;
}

/** Reset cached locale (for testing). */
export function resetLocale(): void {
  currentLocale = null;
}

export type { Locale };
