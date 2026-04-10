export const FPS = 30;
export const WIDTH = 800;
export const HEIGHT = 450;
export const DURATION_SECONDS = 27;
export const DURATION_FRAMES = FPS * DURATION_SECONDS;

export const SCENE_DURATIONS = {
  painPoint: 3,      // 快速打字 + 消散 + 缓冲
  brandReveal: 3,    // slogan + Logo 结晶 + 停留
  import: 4,         // 快速打字/扫描 + 停留 ~1.5s
  summarize: 5,      // 快速进度 + 笔记 + 停留 ~1.5s
  search: 4,         // 快速打字 + 结果 + 停留 ~1.5s
  mcp: 4,            // 快速输出 + 循环图 + 停留 ~1.5s
  outro: 4,          // Logo + 命令 + GitHub + 停留 ~2s
} as const;

export const SCENE_FRAMES = {
  painPoint: SCENE_DURATIONS.painPoint * FPS,
  brandReveal: SCENE_DURATIONS.brandReveal * FPS,
  import: SCENE_DURATIONS.import * FPS,
  summarize: SCENE_DURATIONS.summarize * FPS,
  search: SCENE_DURATIONS.search * FPS,
  mcp: SCENE_DURATIONS.mcp * FPS,
  outro: SCENE_DURATIONS.outro * FPS,
} as const;

export const TRANSITION_FRAMES = 10;

export const BRAND = {
  deepPurple: '#4A2D7A',
  purple: '#7B4DAA',
  lavender: '#B488D9',
  cobaltBlue: '#3B6DC6',
  blue: '#5B8DEF',
  white: '#E8E9ED',
  dimWhite: '#8B8FA3',
  muted: '#5C5F6E',
  bg: '#0A0C10',
  terminalBg: '#0D0F14',
} as const;

export const SOURCE_COLORS = {
  claudeCode: '#E8A838',
  codex: '#4ADE80',
  cursor: '#5B8DEF',
} as const;

export const ANSI = {
  green: '#4ADE80',
  yellow: '#F59E0B',
  gray: '#5C5F6E',
  white: '#E8E9ED',
  brightWhite: '#FFFFFF',
  red: '#EF4444',
  cyan: '#22D3EE',
  purple: '#B488D9',
  blue: '#5B8DEF',
} as const;

export const TEXT = {
  slogan1: 'Your AI conversations disappear.',
  slogan2: "Your knowledge shouldn't.",
  brandName: 'ChatCrystal',
  installCmd: 'npm install -g chatcrystal',
  githubUrl: 'github.com/ZengLiangYi/ChatCrystal',
} as const;

export const TYPEWRITER = {
  charFrames: 2,
  cursorBlink: 16,
} as const;

export const SPINNER_CHARS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
