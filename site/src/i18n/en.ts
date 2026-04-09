export const en = {
  meta: {
    title: 'ChatCrystal — Turn AI Conversations into Searchable Knowledge',
    description: 'Open-source, local-first tool that crystallizes your AI coding conversations (Claude Code, Cursor, Codex) into structured, searchable knowledge.',
  },
  nav: {
    features: 'Features',
    howItWorks: 'How It Works',
    cli: 'CLI',
    github: 'GitHub',
  },
  hero: {
    badge: 'Open Source · Local First',
    title: 'Turn AI Conversations into Searchable Knowledge',
    subtitle: 'Import conversations from Claude Code, Cursor, and Codex CLI. AI crystallizes them into structured notes with semantic search. Everything stays on your machine.',
    installCmd: 'npm i -g chatcrystal',
    copied: 'Copied!',
    downloadDesktop: 'Download Desktop App',
  },
  integrations: {
    heading: 'Works with your favorite AI coding tools',
    claudeCode: { name: 'Claude Code', desc: 'JSONL conversations' },
    cursor: { name: 'Cursor', desc: 'Workspace history' },
    codex: { name: 'Codex CLI', desc: 'Session events' },
  },
  howItWorks: {
    heading: 'How It Works',
    steps: [
      { title: 'Import', desc: 'Auto-scan your local AI conversation history' },
      { title: 'Crystallize', desc: 'LLM generates structured notes: title, summary, key conclusions, code snippets, tags' },
      { title: 'Search', desc: 'Semantic search your knowledge base — find anything, anytime' },
    ],
  },
  features: {
    heading: 'Everything you need',
    items: [
      { title: 'Semantic Search', desc: 'Search with natural language, not just keywords' },
      { title: 'Structured Notes', desc: 'Auto-extract titles, summaries, key conclusions, and code snippets' },
      { title: 'MCP Integration', desc: 'AI tools query your knowledge base directly' },
      { title: 'Smart Tags', desc: 'Auto-categorize and browse by tags' },
      { title: 'CLI Toolkit', desc: 'One set of commands to manage all your knowledge' },
      { title: 'Desktop App', desc: 'Runs in system tray, auto-imports in the background' },
    ],
  },
  localFirst: {
    heading: 'Your data stays local',
    yourMachine: 'Your machine',
    points: [
      { title: 'Never leaves your machine', desc: 'SQLite local storage, zero cloud dependency' },
      { title: 'Fully open source', desc: 'MIT License, transparent and auditable' },
      { title: "You're in control", desc: 'Choose your LLM provider — supports Ollama for fully local AI' },
    ],
  },
  cli: {
    heading: 'Powerful CLI',
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
