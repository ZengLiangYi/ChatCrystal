import type { ThemeDefinition } from './theme.types.ts';

export const darkWorkshop: ThemeDefinition = {
  name: 'dark-workshop',
  displayName: '暗室',
  colors: {
    bgPrimary: '#101113',
    bgSecondary: '#15171A',
    bgTertiary: '#202329',
    border: '#2A2D31',
    textPrimary: '#F2F0EA',
    textSecondary: '#A7A29A',
    textMuted: '#6F716E',
    accent: '#E7B65F',
    accentHover: '#F1C978',
    info: '#80A7FF',
    success: '#63D297',
    warning: '#F59E0B',
    error: '#EF4444',
    codeBg: '#0B0C0E',
  },
  fonts: {
    display: '"Aptos Display", "HarmonyOS Sans SC", "Microsoft YaHei UI", system-ui, sans-serif',
    body: '"Aptos", "HarmonyOS Sans SC", "Microsoft YaHei UI", "Noto Sans SC", system-ui, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
  },
  radius: '6px',
  density: 'compact',
};
