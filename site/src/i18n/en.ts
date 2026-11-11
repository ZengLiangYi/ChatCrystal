export const en = {
  meta: {
    title: 'ChatCrystal — Turn AI Conversations into Searchable Knowledge',
    description: 'Open-source, local-first AI PKM and personal knowledge management app that turns conversations from 32 AI coding agents — Claude Code, Claude Desktop, Codex CLI, Cursor, Copilot, Gemini CLI, OpenCode, Pi, Kimi Code and more — into searchable notes, a tag graph, and MCP memory.',
    keywords: 'AI PKM, personal knowledge management, personal knowledge base, local-first, semantic search, MCP, Claude Code, Codex CLI, Cursor, Gemini CLI, AI memory',
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
      { value: '32', label: 'AI agent harnesses' },
      { value: 'Local', label: 'SQLite + vector index' },
      { value: 'MCP', label: 'Recall knowledge from agents' },
    ],
  },
  integrations: {
    heading: 'Works with the agents you build with',
    subheading: 'Every conversation is imported locally — from Windows, WSL distros and VS Code Remote workspaces.',
    loopAriaA: 'AI coding agents and IDE assistants',
    loopAriaB: 'More AI coding agents, CLI and desktop harnesses',
    caption: '32 agent harnesses · local, WSL and VS Code Remote histories',
  },
  howItWorks: {
    heading: 'From chat history to reusable knowledge',
    steps: [
      { title: 'Import', desc: 'Scan Claude Code, Codex CLI, Cursor, Copilot, Gemini CLI and other agent histories from your machine.' },
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
    blog: 'Author & Blog',
  },
} as const;

export type Translations = typeof en;
