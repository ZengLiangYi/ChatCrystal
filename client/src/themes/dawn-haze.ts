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
    accentForeground: '#FFFDF8', // warm paper highlight
    info:         '#4A7FA5',   // indigo wash
    success:      '#5A8A5C',   // moss green
    warning:      '#C4883A',   // ochre
    error:        '#C44B4B',   // vermillion
    errorForeground: '#FFFDF8',
    codeBg:       '#ECE8E1',   // vellum
    sourceClaudeCode: '#C45E39',
    sourceCodex:     '#087A60',
    sourceCursor:    '#7C3DBA',
    sourceTrae:      '#4C57BF',
    sourceCopilot:   '#1F5EBD',
    graphEdgeCausedBy: '#B85B4D',
    graphEdgeLeadsTo: '#B9793D',
    graphEdgeResolvedBy: '#5A8A5C',
    graphEdgeSimilarTo: '#4A7FA5',
    graphEdgeContradicts: '#B8584B',
    graphEdgeDependsOn: '#7652A6',
    graphEdgeExtends: '#3D8B86',
    graphEdgeReferences: '#8B8376',
    graphProject1: '#B96A47',
    graphProject2: '#A9894B',
    graphProject3: '#687F52',
    graphProject4: '#4F827E',
    graphProject5: '#527C9B',
    graphProject6: '#6D5B9B',
    graphProject7: '#96688E',
    graphProject8: '#877C66',
    graphProject9: '#667B87',
    graphProject10: '#A55D5B',
  },
  fonts: {
    display: '"IBM Plex Sans", "Noto Serif SC", serif',
    body:    '"IBM Plex Sans", "Noto Sans SC", system-ui, sans-serif',
    mono:    '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
  },
  radius: '8px',
  density: 'normal',
};
