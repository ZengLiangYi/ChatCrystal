import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ThemeDefinition } from '@/themes/theme.types.ts';
import { themeToCSSVars } from '@/themes/theme.types.ts';
import { darkWorkshop } from '@/themes/dark-workshop.ts';

// Registry of available themes
const themes: Record<string, ThemeDefinition> = {
  'dark-workshop': darkWorkshop,
};

interface ThemeContextValue {
  theme: ThemeDefinition;
  themeName: string;
  setTheme: (name: string) => void;
  availableThemes: string[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeName] = useState(loadSavedTheme);

  const theme = themes[themeName] ?? darkWorkshop;

  useEffect(() => {
    const vars = themeToCSSVars(theme);
    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
    // Set color-scheme for browser UI
    root.style.colorScheme = theme.colors.bgPrimary.startsWith('#0') ? 'dark' : 'light';
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
        availableThemes: Object.keys(themes),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
