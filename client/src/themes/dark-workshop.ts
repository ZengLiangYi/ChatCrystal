import type { ThemeDefinition } from './theme.types.ts';

export const darkWorkshop: ThemeDefinition = {
  name: 'dark-workshop',
  displayName: '暗室',
  colors: {
    bgPrimary: '#0F1117',
    bgSecondary: '#161922',
    bgTertiary: '#1E2130',
    border: '#2A2D3A',
    textPrimary: '#E8E9ED',
    textSecondary: '#8B8FA3',
    textMuted: '#5C5F6E',
    accent: '#E8A838',
    accentHover: '#F0B84D',
    info: '#5B8DEF',
    success: '#4ADE80',
    warning: '#F59E0B',
    error: '#EF4444',
    codeBg: '#0D0F14',
  },
  fonts: {
    display: '"JetBrains Mono", "Fira Code", monospace',
    body: '"IBM Plex Sans", "Noto Sans SC", system-ui, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
  },
  radius: '6px',
  density: 'compact',
};
