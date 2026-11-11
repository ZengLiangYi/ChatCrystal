/**
 * Logo data for the integrations marquee.
 *
 * Logo files live in `src/assets/logos/<id>.svg|png` and are picked up through
 * import.meta.glob, so a missing file never breaks the site build: it falls
 * back to a monogram tile drawn from the brand colour.
 */

export interface AgentLogoMeta {
  /** Matches the conversation-source id used by the app. */
  id: string;
  /** Display name shown under the logo on hover. */
  name: string;
  /** Official site or repository, when known. */
  href?: string;
  /** Brand colour used for the hover label and the monogram fallback. */
  color: string;
  /**
   * Another source that shares the same brand mark (e.g. Copilot CLI and
   * Copilot Chat, Qoder CN and Qoder). Aliased sources are still importable in
   * the app, but the marquee shows the brand once.
   */
  aliasOf?: string;
}

export interface LogoLoopItem {
  src: string;
  alt: string;
  title: string;
  href?: string;
  hoverColor: string;
}

const svgFiles = import.meta.glob('../assets/logos/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const pngFiles = import.meta.glob('../assets/logos/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const fileById = new Map<string, string>();
for (const [path, url] of [...Object.entries(svgFiles), ...Object.entries(pngFiles)]) {
  const id = path.split('/').pop()?.replace(/\.(svg|png)$/i, '');
  if (id) fileById.set(id, url);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Data-URI monogram used when no logo asset was found for a source. */
function monogram(name: string, color: string): string {
  const letters = initials(name) || 'AI';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${color}"/>` +
    `<text x="32" y="41" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" ` +
    `font-size="25" font-weight="700" fill="#ffffff">${letters}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function toItem(meta: AgentLogoMeta): LogoLoopItem {
  return {
    src: fileById.get(meta.id) ?? monogram(meta.name, meta.color),
    alt: `${meta.name} logo`,
    title: meta.name,
    ...(meta.href ? { href: meta.href } : {}),
    hoverColor: meta.color,
  };
}

/** The 32 agent harnesses ChatCrystal imports, in display order. */
export const AGENT_LOGOS: AgentLogoMeta[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    href: 'https://claude.com/product/claude-code',
    color: '#D97757',
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    href: 'https://claude.ai/download',
    color: '#D97757',
    aliasOf: 'claude-code',
  },
  {
    id: 'codex',
    name: 'Codex',
    href: 'https://openai.com/codex/',
    color: '#7A9DFF',
  },
  { id: 'cursor', name: 'Cursor', href: 'https://cursor.com', color: '#14120B' },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    href: 'https://github.com/features/copilot',
    color: '#111111',
  },
  {
    id: 'copilot-cli',
    name: 'Copilot CLI',
    href: 'https://github.com/github/copilot-cli',
    color: '#111111',
    aliasOf: 'copilot',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    href: 'https://github.com/google-gemini/gemini-cli',
    color: '#3186FF',
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    href: 'https://github.com/QwenLM/qwen-code',
    color: '#082DFF',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    href: 'https://opencode.ai',
    color: '#131010',
  },
  { id: 'cline', name: 'Cline', href: 'https://cline.bot', color: '#1C1C24' },
  { id: 'roo', name: 'Roo Code', href: 'https://roocode.com', color: '#000000' },
  {
    id: 'kilo',
    name: 'Kilo Code',
    href: 'https://kilocode.ai',
    color: '#FAF74F',
  },
  {
    id: 'continue',
    name: 'Continue',
    href: 'https://continue.dev',
    color: '#33323A',
  },
  { id: 'droid', name: 'Droid', href: 'https://factory.ai', color: '#000000' },
  {
    id: 'goose',
    name: 'Goose',
    href: 'https://block.github.io/goose/',
    color: '#000000',
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    href: 'https://antigravity.google',
    color: '#3087FB',
  },
  { id: 'grok', name: 'Grok Build', href: 'https://x.ai', color: '#000000' },
  {
    id: 'kimi',
    name: 'Kimi Code',
    href: 'https://www.kimi.com/code',
    color: '#1783FF',
  },
  {
    id: 'minimax-code',
    name: 'MiniMax Code',
    href: 'https://www.minimax.io',
    color: '#E2167E',
  },
  {
    id: 'pi',
    name: 'Pi',
    href: 'https://github.com/badlogic/pi-mono',
    color: '#F09082',
  },
  {
    id: 'omp',
    name: 'oh-my-pi',
    href: 'https://github.com/can1357/oh-my-pi',
    color: '#9B4DFF',
  },
  { id: 'trae', name: 'Trae', href: 'https://www.trae.ai', color: '#32F08C' },
  {
    id: 'codebuddy',
    name: 'CodeBuddy',
    href: 'https://copilot.tencent.com',
    color: '#6C4DFF',
  },
  {
    id: 'workbuddy',
    name: 'WorkBuddy',
    href: 'https://www.workbuddy.ai',
    color: '#01C886',
  },
  { id: 'qoder', name: 'Qoder', href: 'https://qoder.com', color: '#2ADB5C' },
  {
    id: 'qoder-cn',
    name: 'Qoder CN',
    href: 'https://qoder.com',
    color: '#2ADB5C',
    aliasOf: 'qoder',
  },
  { id: 'zcode', name: 'ZCode', href: 'https://github.com/zai-org/ZCode', color: '#000000' },
  {
    id: 'dsh',
    name: 'DeepSeek Harness',
    href: 'https://www.deepseek.com',
    color: '#4D6BFE',
  },
  { id: 'raft', name: 'Raft', color: '#111827' },
  { id: 'cindy', name: 'Cindy', color: '#E60012' },
  { id: 'hermes', name: 'Hermes', color: '#1F1F1F' },
  { id: 'alma', name: 'Alma', color: '#000000' },
];

/** Brands shown in the marquee: aliased sources share their mark once. */
export const MARQUEE_LOGOS: AgentLogoMeta[] = AGENT_LOGOS.filter(
  (meta) => !meta.aliasOf,
);

const rowAIds = new Set([
  'claude-code',
  'codex',
  'cursor',
  'copilot',
  'gemini',
  'qwen',
  'opencode',
  'cline',
  'roo',
  'kilo',
  'continue',
  'droid',
  'goose',
  'antigravity',
]);

export const AGENT_LOGOS_ROW_A: LogoLoopItem[] = MARQUEE_LOGOS.filter((meta) =>
  rowAIds.has(meta.id),
).map(toItem);

export const AGENT_LOGOS_ROW_B: LogoLoopItem[] = MARQUEE_LOGOS.filter(
  (meta) => !rowAIds.has(meta.id),
).map(toItem);

/** Number of importable sources behind the marquee. */
export const AGENT_LOGO_COUNT = AGENT_LOGOS.length;

/** Number of distinct brand marks rendered by the marquee. */
export const MARQUEE_LOGO_COUNT = MARQUEE_LOGOS.length;
