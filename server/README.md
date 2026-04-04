<div align="center">

<img src="https://raw.githubusercontent.com/ZengLiangYi/ChatCrystal/main/electron/icon.png" alt="ChatCrystal" width="80" />

# ChatCrystal

**Crystallize knowledge from your AI conversations**

[![npm](https://img.shields.io/npm/v/chatcrystal?style=flat-square)](https://www.npmjs.com/package/chatcrystal)
[![GitHub](https://img.shields.io/github/stars/ZengLiangYi/ChatCrystal?style=flat-square)](https://github.com/ZengLiangYi/ChatCrystal)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](https://github.com/ZengLiangYi/ChatCrystal/blob/main/LICENSE)

</div>

---

ChatCrystal collects conversations from AI coding tools (Claude Code, Cursor, Codex CLI), uses LLM to distill them into searchable structured notes, and builds your personal knowledge base.

## Install

```bash
npm install -g chatcrystal
```

Requires Node.js >= 20 and an LLM service ([Ollama](https://ollama.ai/), OpenAI, Anthropic, Google AI, or any OpenAI-compatible API).

## Quick Start

```bash
crystal import                     # Scan and import AI conversations
crystal summarize --all            # Batch summarize into notes
crystal search "React state"       # Semantic search your knowledge
```

The server auto-launches in background on first command. No manual setup needed.

## CLI Commands

```bash
# Knowledge retrieval
crystal search <query> [--limit 10]     # Semantic search
crystal notes list [--tag X]            # Browse notes
crystal notes get <id>                  # View note detail
crystal notes relations <id>            # View note relations
crystal tags                            # List tags with counts

# Data management
crystal import [--source claude-code]   # Import conversations
crystal summarize <id>                  # Summarize one conversation
crystal summarize --all                 # Batch summarize
crystal summarize --retry-errors        # Retry failed summaries
crystal status                          # Server status and DB stats

# Configuration
crystal config get                      # View config
crystal config set llm.provider openai  # Update config
crystal config test                     # Test LLM connection

# Server management
crystal serve                           # Start server (foreground)
crystal serve -d                        # Start server (daemon)
crystal serve stop                      # Stop daemon
crystal serve status                    # Check if running
```

**Global options:** `--base-url <url>` (server address), `--json` (force JSON output), `--version`

**Output:** TTY-aware — colored tables in terminal, JSON when piped.

## MCP Server

Integrate with AI coding tools so they can retrieve knowledge from your conversation history during coding.

```bash
crystal mcp                             # Start MCP stdio server
```

### Claude Code

Add to `settings.json`:

```json
{
  "mcpServers": {
    "chatcrystal": {
      "command": "crystal",
      "args": ["mcp"]
    }
  }
}
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `search_knowledge` | Semantic search across notes |
| `get_note` | Get full note content (summary, conclusions, code snippets) |
| `list_notes` | Browse notes by tag or keyword |
| `get_relations` | Get related notes with relationship types |

## Configuration

Configure via `crystal config set` or `.env` file:

```bash
# LLM (ollama/openai/anthropic/google/azure/custom)
crystal config set llm.provider openai
crystal config set llm.model gpt-4o
crystal config set llm.apiKey sk-...

# Embedding (ollama/openai/google/azure/custom)
crystal config set embedding.provider ollama
crystal config set embedding.model nomic-embed-text
```

## Data Sources

Automatically detects and imports from:

| Source | Path |
|--------|------|
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Codex CLI | `~/.codex/sessions/**/*.jsonl` |
| Cursor | Platform-specific `state.vscdb` |

## Web UI & Desktop App

ChatCrystal also has a web UI and Electron desktop app. See the [GitHub repository](https://github.com/ZengLiangYi/ChatCrystal) for details.

## License

[MIT](https://github.com/ZengLiangYi/ChatCrystal/blob/main/LICENSE)
