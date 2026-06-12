export const en = {
  meta: {
    title: 'ChatCrystal — Turn AI Conversations into Searchable Knowledge',
    description: 'Open-source, local-first AI PKM and personal knowledge management app that turns Claude Code, Cursor, Codex CLI, Trae, and GitHub Copilot conversations into searchable notes, a tag graph, and MCP memory.',
    keywords: 'AI PKM, personal knowledge management, personal knowledge base, local-first, semantic search, MCP, Claude Code, Cursor, Codex CLI, AI memory',
  },
  nav: {
    features: 'Features',
    howItWorks: 'How It Works',
    cli: 'CLI',
    github: 'GitHub',
  },
  hero: {
    badge: '0.5.2 · Dawn Haze UI refresh',
    title: 'ChatCrystal',
    subtitle: 'A calm local workspace that turns AI coding conversations into notes, tag graphs, Markdown exports, and reusable context for your next agent session.',
    installCmd: 'npm i -g chatcrystal',
    copied: 'Copied!',
    downloadDesktop: 'Download Desktop App',
    starOnGitHub: 'Star on GitHub',
    highlights: [
      { value: '5', label: 'AI coding sources' },
      { value: 'Local', label: 'SQLite + vector index' },
      { value: 'MCP', label: 'Recall knowledge from agents' },
    ],
  },
  integrations: {
    heading: 'Works with your favorite AI coding tools',
    claudeCode: { name: 'Claude Code', desc: 'JSONL conversations' },
    cursor: { name: 'Cursor', desc: 'Workspace history' },
    codex: { name: 'Codex CLI', desc: 'Session events' },
    trae: { name: 'Trae', desc: 'Agent task history' },
    copilot: { name: 'GitHub Copilot', desc: 'Chat sessions' },
  },
  howItWorks: {
    heading: 'From chat history to reusable knowledge',
    steps: [
      { title: 'Import', desc: 'Scan Claude Code, Cursor, Codex CLI, Trae, and Copilot histories from your machine.' },
      { title: 'Crystallize', desc: 'LLMs extract summaries, decisions, code snippets, source metadata, and tags.' },
      { title: 'Explore', desc: 'Search semantically, browse notes, and inspect the tag-based knowledge graph.' },
      { title: 'Reuse', desc: 'Export Markdown or let MCP recall the right memories inside your agent workflow.' },
    ],
  },
  features: {
    eyebrow: 'What changed in 0.5.x',
    heading: 'A brighter workspace for serious recall',
    items: [
      { title: 'Dawn Haze interface', desc: 'A light desktop workspace with warm paper surfaces, compact controls, and shadcn/ui polish.' },
      { title: 'Tag knowledge graph', desc: 'Tags become knowledge-point nodes with readable neighborhoods, details, and project context.' },
      { title: 'Sharper semantic search', desc: 'Natural-language results now balance embeddings with lexical signal so weak hits stay out.' },
      { title: 'Markdown export', desc: 'Save a note as clean Markdown with localized headings and minimal frontmatter.' },
      { title: 'Agent memory loop', desc: 'MCP tools recall and write reusable task memories from the same local knowledge base.' },
      { title: 'Desktop and cloud controls', desc: 'Use the tray app, manual update checks, token access, and optional personal cloud deployment.' },
    ],
  },
  localFirst: {
    heading: 'Your data stays local',
    yourMachine: 'Your machine',
    points: [
      { title: 'Never leaves your machine', desc: 'SQLite local storage, zero cloud dependency' },
      { title: 'Fully open source', desc: 'Apache-2.0 licensed, transparent and auditable' },
      { title: "You're in control", desc: 'Choose your LLM provider — supports Ollama for fully local AI' },
    ],
  },
  cli: {
    eyebrow: 'CLI + MCP',
    heading: 'Keep the workflow close to the terminal',
    subheading: 'The same local server powers the desktop app, REST API, CLI, and MCP memory tools.',
    commands: [
      { command: 'crystal import --source codex', note: 'scan local sessions' },
      { command: 'crystal search "jwt cache strategy"', note: 'semantic recall' },
      { command: 'crystal mcp', note: 'serve agent tools' },
    ],
  },
  footer: {
    tagline: 'Crystallize your AI knowledge',
    github: 'GitHub',
    npm: 'npm',
    docs: 'Docs',
    releases: 'Releases',
  },
} as const;

export type Translations = typeof en;
