import type { ThemeDefinition } from './theme.types.ts';

/**
 * 碧渊 — Jade Abyss
 * Inspired by Dieter Rams' functionalist design philosophy:
 * "Less, but better." A cool, precise dark theme with
 * jade-teal accent — like a precision instrument panel.
 */
export const jadeAbyss: ThemeDefinition = {
  name: 'jade-abyss',
  displayName: '碧渊',
  colors: {
    bgPrimary:    '#0C0E12',   // deep obsidian
    bgSecondary:  '#12151B',   // instrument panel
    bgTertiary:   '#1A1E26',   // raised surface
    border:       '#252A34',   // precision edge
    textPrimary:  '#D8DDE6',   // cool white
    textSecondary:'#7C8494',   // steel grey
    textMuted:    '#4E5563',   // recessed label
    accent:       '#3DBDA0',   // jade indicator
    accentHover:  '#50D4B6',   // active jade
    info:         '#5A9CF5',   // signal blue
    success:      '#45C882',   // status green
    warning:      '#E5A84B',   // caution amber
    error:        '#E85454',   // alert red
    codeBg:       '#090B0F',   // terminal black
  },
  fonts: {
    display: '"IBM Plex Mono", "JetBrains Mono", monospace',
    body:    '"IBM Plex Sans", "Noto Sans SC", system-ui, sans-serif',
    mono:    '"IBM Plex Mono", "JetBrains Mono", "Cascadia Code", monospace',
  },
  radius: '4px',
  density: 'compact',
};
