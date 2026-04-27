import { useEffect, useState, type ReactNode } from 'react';
import type { ThemeDefinition } from '@/themes/theme.types.ts';
import { themeToCSSVars } from '@/themes/theme.types.ts';
import { darkWorkshop } from '@/themes/dark-workshop.ts';
import { dawnHaze } from '@/themes/dawn-haze.ts';
import { jadeAbyss } from '@/themes/jade-abyss.ts';
import { ThemeContext } from './theme-context.ts';

// Registry of available themes
const themes: Record<string, ThemeDefinition> = {
  'dark-workshop': darkWorkshop,
  'dawn-haze': dawnHaze,
  'jade-abyss': jadeAbyss,
};

const STORAGE_KEY = 'chatcrystal-theme';
const STORAGE_VERSION = 1;

function loadSavedTheme(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 'dark-workshop';
    const parsed = JSON.parse(raw);
    if (parsed.version === STORAGE_VERSION && themes[parsed.theme]) {
      return parsed.theme;
    }
  } catch { /* ignore */ }
  return 'dark-workshop';
}

function saveTheme(name: string) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: STORAGE_VERSION, theme: name }),
  );
}

/** Determine color-scheme from background lightness */
function detectColorScheme(bgHex: string): 'dark' | 'light' {
  const hex = bgHex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  // Relative luminance approximation
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeName] = useState(loadSavedTheme);

  const theme = themes[themeName] ?? darkWorkshop;

  useEffect(() => {
    const vars = themeToCSSVars(theme);
    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
    root.style.colorScheme = detectColorScheme(theme.colors.bgPrimary);
  }, [theme]);

  const setTheme = (name: string) => {
    if (themes[name]) {
      setThemeName(name);
      saveTheme(name);
    }
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        themeName,
        setTheme,
        availableThemes: Object.values(themes),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
