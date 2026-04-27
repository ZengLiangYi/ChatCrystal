import { createContext } from 'react';
import type { ThemeDefinition } from '@/themes/theme.types.ts';

export interface ThemeContextValue {
  theme: ThemeDefinition;
  themeName: string;
  setTheme: (name: string) => void;
  availableThemes: ThemeDefinition[];
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
