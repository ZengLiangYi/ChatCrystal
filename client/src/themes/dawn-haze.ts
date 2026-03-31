import type { ThemeDefinition } from './theme.types.ts';

/**
 * 晨岚 — Dawn Haze
 * Inspired by Zao Wou-Ki's atmospheric ink-wash landscapes.
 * A warm, luminous light theme with ink-toned accents and
 * soft layered surfaces evoking morning mist over water.
 */
export const dawnHaze: ThemeDefinition = {
  name: 'dawn-haze',
  displayName: '晨岚',
  colors: {
    bgPrimary:    '#F6F4F0',   // warm parchment white
    bgSecondary:  '#EDEAE4',   // mist layer
    bgTertiary:   '#E2DED6',   // deeper fog
    border:       '#D4CFC6',   // warm stone edge
    textPrimary:  '#2C2A26',   // ink black (warm)
    textSecondary:'#6B665C',   // aged ink mid-tone
    textMuted:    '#9E978A',   // faded brush stroke
    accent:       '#B8584B',   // cinnabar red — seal stamp
    accentHover:  '#CC6558',   // warmer cinnabar
    info:         '#4A7FA5',   // indigo wash
    success:      '#5A8A5C',   // moss green
    warning:      '#C4883A',   // ochre
    error:        '#C44B4B',   // vermillion
    codeBg:       '#ECE8E1',   // vellum
  },
  fonts: {
    display: '"IBM Plex Sans", "Noto Serif SC", serif',
    body:    '"IBM Plex Sans", "Noto Sans SC", system-ui, sans-serif',
    mono:    '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
  },
  radius: '8px',
  density: 'normal',
};
