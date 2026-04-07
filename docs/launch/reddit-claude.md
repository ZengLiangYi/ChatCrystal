# Reddit — r/ClaudeAI

**Title:** I built a tool to search across all my Claude Code conversations and turn them into a knowledge base

---

If you use Claude Code heavily, you know the problem: every project gets its own folder under `~/.claude/projects/`, each conversation is a JSONL file, and once a session is closed there's basically no way to find what you discussed without manually digging through files.

I built **ChatCrystal** to solve this. It:

- **Auto-imports** all your Claude Code conversations (watches for new ones too)
- **Summarizes each one** using an LLM — generates a title, summary, key conclusions, relevant code snippets, and tags
- **Semantic search** across everything — search by meaning, not just keywords
- **MCP integration** — Claude Code can query your knowledge base directly mid-session via an MCP server

It also strips out the `<system-reminder>` and `<command-name>` XML tags that Claude Code injects, so the summaries are clean.

Runs **100% locally** — your conversations don't go anywhere you don't send them. You can use Ollama for a fully local setup with no API costs at all.

```bash
npm install -g chatcrystal
crystal serve -d
crystal import
crystal search "that authentication bug I fixed last month"
```

Also has an Electron desktop app if you prefer a GUI.

GitHub: https://github.com/ZengLiangYi/ChatCrystal

Still early days — would love feedback from Claude Code users on what features would be most useful.
