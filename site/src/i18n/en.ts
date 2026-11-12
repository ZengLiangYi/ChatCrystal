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
    badge: '0.7.0 · Seamless import',
    title: 'ChatCrystal',
    subtitle: 'A calm local workspace that syncs AI coding conversations automatically, then turns them into notes, tag graphs, Markdown exports, and reusable context for your next agent session.',
    installCmd: 'npm i -g chatcrystal',
    copied: 'Copied!',
    downloadDesktop: 'Download Desktop App',
    starOnGitHub: 'Star on GitHub',
    highlights: [
      { value: '32', label: 'AI agent harnesses' },
      { value: 'Local', label: 'Native SQLite + WAL' },
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
      { title: 'Sync', desc: 'ChatCrystal syncs Claude Code, Codex CLI, Cursor, Copilot, Gemini CLI and 32 harnesses automatically — no import step, and the list appears as soon as a scan finishes.' },
      { title: 'Crystallize', desc: 'LLMs extract summaries, decisions, code snippets, source metadata, and tags.' },
      { title: 'Explore', desc: 'Search semantically, browse notes, and inspect the tag-based knowledge graph.' },
      { title: 'Reuse', desc: 'Export Markdown or let MCP recall the right memories inside your agent workflow.' },
    ],
  },
  features: {
    eyebrow: 'What changed in 0.7.0',
    heading: 'Seamless import and a faster local engine',
    items: [
      { title: 'Seamless background sync', desc: 'Startup and file-watch passes keep every agent history current — no import button, no waiting for a full scan.' },
      { title: 'Instant index-first list', desc: 'Conversation rows appear as soon as a source scan finishes; transcripts fill in as they parse and can be opened while they load.' },
      { title: 'Tag knowledge graph', desc: 'Tags become knowledge-point nodes with readable neighborhoods, details, and project context.' },
      { title: 'Sharper semantic search', desc: 'Natural-language results now balance embeddings with lexical signal so weak hits stay out.' },
      { title: 'Markdown export', desc: 'Save a note as clean Markdown with localized headings and minimal frontmatter.' },
      { title: 'Agent memory loop', desc: 'MCP tools recall and write reusable task memories from the same local knowledge base.' },
      { title: 'Reliable desktop setup', desc: 'First-run onboarding connects a local core or cloud instance, and packaged builds load the setup page correctly.' },
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
      { command: 'crystal import --source codex', note: 'manual / CI import' },
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
