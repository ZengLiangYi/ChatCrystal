export interface ThemeDefinition {
  name: string;
  displayName: string;
  colors: {
    bgPrimary: string;
    bgSecondary: string;
    bgTertiary: string;
    border: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    accent: string;
    accentHover: string;
    info: string;
    success: string;
    warning: string;
    error: string;
    codeBg: string;
  };
  fonts: {
    display: string;
    body: string;
    mono: string;
  };
  radius: string;
  density: 'compact' | 'normal' | 'spacious';
}

/** Convert ThemeDefinition colors to CSS custom properties */
export function themeToCSSVars(theme: ThemeDefinition): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme.colors)) {
    // camelCase → kebab-case: bgPrimary → bg-primary
    const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    vars[`--${cssKey}`] = value;
  }
  vars['--font-display'] = theme.fonts.display;
  vars['--font-body'] = theme.fonts.body;
  vars['--font-mono'] = theme.fonts.mono;
  vars['--radius'] = theme.radius;
  return vars;
}
