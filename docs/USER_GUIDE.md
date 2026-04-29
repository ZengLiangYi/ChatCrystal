# ChatCrystal User Guide

English | [简体中文](USER_GUIDE.zh-CN.md)

This guide covers installation, daily use, configuration, and common issues.

## Installation

### Global CLI

```bash
npm install -g chatcrystal
crystal serve -d
crystal import
```

Open http://localhost:3721 after the server starts.

### From Source

```bash
git clone https://github.com/ZengLiangYi/ChatCrystal.git
cd ChatCrystal
npm install
npm run dev
```

Development mode starts the API server on http://localhost:3721 and the Vite client on http://localhost:13721.

### Desktop App

```bash
npm run dev:electron
npm run build:electron
```

The installer is generated under `release/`. The desktop app uses the same default data directory as the CLI and MCP server: `~/.chatcrystal/data`.

## Workflow

1. Click **Import** to scan Claude Code, Codex CLI, Cursor, Trae, and GitHub Copilot conversations.
2. Browse raw conversations on the **Conversations** page.
3. Click **Summarize** or run batch summarization to create notes.
4. Search on the **Search** page; enable related-note expansion when you want broader context.
5. Open the graph view to explore relationships between notes.
6. Use the **Settings** page to switch LLM and embedding providers.

## CLI Commands

```bash
crystal status                          # Server status and DB stats
crystal import [--source claude-code]   # Scan and import conversations
crystal search "query" [--limit 10]     # Semantic search
crystal notes list [--tag X]            # Browse notes
crystal notes get <id>                  # View note detail
crystal notes relations <id>            # View note relations
crystal tags                            # List tags with counts
crystal summarize <id>                  # Summarize one conversation
crystal summarize --all                 # Batch summarize
crystal config get                      # View config
crystal config set llm.provider openai  # Update config
crystal config test                     # Test LLM connection
crystal serve -d                        # Start server in background
crystal serve stop                      # Stop background server
crystal mcp                             # Start MCP stdio server
```

Commands that need the server can auto-start it in the background when it is not running. Terminal output is TTY-aware: tables for interactive terminals, JSON when piped.

## Configuration

ChatCrystal stores runtime configuration in `config.json` under the active data directory.

Default locations:

- CLI, MCP, npm package, repository checkout, and Electron: `~/.chatcrystal/data/config.json`
- Custom data directory: `<DATA_DIR>/config.json`

`.env` is optional. Keep it only for local development overrides such as a custom `PORT`, source path overrides, or pre-seeded provider keys.

Typical `config.json`:

```json
{
  "llm": {
    "provider": "ollama",
    "baseURL": "http://localhost:11434",
    "model": "qwen2.5:7b",
    "apiKey": ""
  },
  "embedding": {
    "provider": "ollama",
    "baseURL": "http://localhost:11434",
    "model": "nomic-embed-text",
    "apiKey": ""
  },
  "enabledSources": ["claude-code", "codex", "cursor", "trae", "copilot"]
}
```

### Provider Examples

You can set these through the Settings page, `crystal config`, `config.json`, or `.env` overrides.

```bash
# OpenAI
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o

# Anthropic
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-20250514

# Google AI
LLM_PROVIDER=google
LLM_API_KEY=AIza...
LLM_MODEL=gemini-2.0-flash

# OpenAI-compatible service
LLM_PROVIDER=custom
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=your-key
LLM_MODEL=anthropic/claude-sonnet-4
```

## LLM and Embedding Models

LLM and embedding models must be configured separately. Semantic search requires a model that supports the `/v1/embeddings` endpoint.

| Provider | Common embedding models |
|---|---|
| Ollama | `nomic-embed-text`, `mxbai-embed-large` |
| OpenAI | `text-embedding-3-small`, `text-embedding-3-large` |
| Google | `text-embedding-004` |

Large language models such as Claude, GPT, and Qwen are not embedding models.

## Troubleshooting

### Semantic search returns 500 "Not Found"

The embedding model is usually misconfigured. Set `EMBEDDING_MODEL` to a dedicated embedding model such as `nomic-embed-text`, not a chat model such as `qwen2.5` or `claude-haiku`.

### ChatCrystal cannot connect to Ollama

Make sure Ollama is running and the models are available:

```bash
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

### Import finds no conversations

Check the source paths in the Settings page or `config.json`. If you still use `.env` overrides, check those paths too.

### The knowledge graph is empty

Generate notes first. Then click relation discovery on a note detail page or run batch relation discovery through the API.

