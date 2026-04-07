# Hacker News — Show HN

**Title:** Show HN: ChatCrystal – Turn AI coding conversations into searchable knowledge

---

I've accumulated hundreds of Claude Code conversations over the past year. Finding something I solved six months ago means scrolling through dozens of JSONL files. I built ChatCrystal to fix that.

**What it does:**
- Watches `~/.claude/projects/` (also Codex CLI and Cursor) and auto-imports new conversations
- Runs each through an LLM to extract: title, summary, key conclusions, code snippets, and tags
- Indexes everything with embeddings for semantic search
- Builds a knowledge graph by having the LLM discover relationships between notes
- Exposes an MCP server so Claude Code can query your own knowledge base mid-session

**Technical choices:**
- **sql.js (WASM SQLite)** — single-file DB, no native addon, works everywhere Node.js does
- **vectra** — local vector index, no external vector DB needed
- **Vercel AI SDK** — provider-agnostic; works with Ollama, OpenAI, Anthropic, Google, or any custom endpoint
- **No cloud** — everything runs locally; your conversations never leave your machine

```bash
npm install -g chatcrystal
crystal serve -d
crystal import
crystal search "how did I fix that webpack issue"
```

Also ships as an Electron desktop app with system tray.

GitHub: https://github.com/ZengLiangYi/ChatCrystal

Happy to answer questions about the architecture or design decisions.
