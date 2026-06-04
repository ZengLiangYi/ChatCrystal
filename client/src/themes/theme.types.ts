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
    accentForeground: string;
    info: string;
    success: string;
    warning: string;
    error: string;
    errorForeground: string;
    codeBg: string;
    sourceClaudeCode: string;
    sourceCodex: string;
    sourceCursor: string;
    sourceTrae: string;
    sourceCopilot: string;
    graphEdgeCausedBy: string;
    graphEdgeLeadsTo: string;
    graphEdgeResolvedBy: string;
    graphEdgeSimilarTo: string;
    graphEdgeContradicts: string;
    graphEdgeDependsOn: string;
    graphEdgeExtends: string;
    graphEdgeReferences: string;
    graphProject1: string;
    graphProject2: string;
    graphProject3: string;
    graphProject4: string;
    graphProject5: string;
    graphProject6: string;
    graphProject7: string;
    graphProject8: string;
    graphProject9: string;
    graphProject10: string;
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
    // camelCase → kebab-case, with numbered palette tokens kept readable:
    // bgPrimary → bg-primary, graphProject1 → graph-project-1
    const cssKey = key
      .replace(/([A-Z])/g, '-$1')
      .replace(/(\D)(\d+)/g, '$1-$2')
      .toLowerCase();
    vars[`--${cssKey}`] = value;
  }
  vars['--font-display'] = theme.fonts.display;
  vars['--font-body'] = theme.fonts.body;
  vars['--font-mono'] = theme.fonts.mono;
  vars['--radius'] = theme.radius;
  return vars;
}
