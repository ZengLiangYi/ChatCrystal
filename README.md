<div align="center">

<img src="electron/icon.png" alt="ChatCrystal" width="120" />

# ChatCrystal

**Turn your AI conversations into searchable knowledge**

[![GitHub release](https://img.shields.io/github/v/release/ZengLiangYi/ChatCrystal?style=flat-square)](https://github.com/ZengLiangYi/ChatCrystal/releases)
[![npm](https://img.shields.io/npm/v/chatcrystal?style=flat-square)](https://www.npmjs.com/package/chatcrystal)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey?style=flat-square)](#)
[![Website](https://img.shields.io/badge/website-ChatCrystal-5A5FD6?style=flat-square)](https://zengliangyi.github.io/ChatCrystal/)

English | [简体中文](README.zh-CN.md)

</div>

---

<div align="center">
<img src="docs/demo.webp" alt="ChatCrystal Demo" width="800" />
</div>

<br>

ChatCrystal collects conversations from AI coding tools (Claude Code, Cursor, Codex CLI, Trae, GitHub Copilot), uses LLM to distill them into searchable structured notes, and builds your personal knowledge base — all running locally.

<div align="center">
<table>
<tr>
<td align="center"><strong>Conversations</strong></td>
<td align="center"><strong>Notes</strong></td>
</tr>
<tr>
<td><img src="docs/screenshots/en/conversations.png" alt="Conversations" width="400" /></td>
<td><img src="docs/screenshots/en/notes.png" alt="Notes" width="400" /></td>
</tr>
<tr>
<td align="center"><strong>Semantic Search</strong></td>
<td align="center"><strong>Knowledge Graph</strong></td>
</tr>
<tr>
<td><img src="docs/screenshots/en/search.png" alt="Semantic Search" width="400" /></td>
<td><img src="docs/screenshots/en/graph.png" alt="Knowledge Graph" width="400" /></td>
</tr>
</table>
</div>

## Why?

After 200+ AI conversations, finding that one solution you discussed last week becomes impossible. ChatCrystal watches your conversation files, auto-generates structured notes, and lets you search across everything with natural language — no cloud, no subscription, runs entirely on your machine.

### Quick Start

```bash
npm install -g chatcrystal
crystal serve -d
crystal import
```

Then open http://localhost:3721 in your browser.

## Features

- **Multi-source ingestion** — Auto-imports conversations from Claude Code, Codex CLI, Cursor, Trae, and GitHub Copilot with real-time file watching
- **Structured LLM summarization** — Generates notes via `generateObject` + Zod schema (guaranteed valid output, auto-retry on schema violation). Turn-based transcript preprocessing selects the most valuable conversation segments within a configurable token budget.
- **Semantic search** — Embedding-powered vector search (vectra) with text preview snippets and relation-aware result expansion. Embedding content includes title, summary, conclusions, tags, and code snippet descriptions.
- **Knowledge graph** — Structured relation discovery via `generateObject` with typed schemas. 8 relation types with confidence scoring and force-directed visualization.
- **Conversation viewer** — Markdown rendering, code highlighting, collapsible tool calls, noise filtering
- **Multi-provider support** — Ollama, OpenAI, Anthropic, Google AI, Azure OpenAI, or any OpenAI-compatible API, switchable at runtime
- **Task queue** — Batch summarization/embedding via p-queue with real-time progress tracking and cancellation
- **Desktop app** — Electron with system tray, minimize-to-tray on close

## How Summarization Works

ChatCrystal uses a multi-stage pipeline to turn raw conversations into searchable knowledge:

### Turn-Based Transcript Preparation

AI coding conversations have a natural **turn** structure — a user gives an instruction, the assistant responds (potentially with many tool calls), and the cycle repeats. Long conversations (100+ messages with heavy MCP tool usage) can't fit in a single LLM context window.

Instead of naive head+tail truncation, ChatCrystal uses a **turn-based selection algorithm**:

1. **Split** — Messages are grouped into turns at user→assistant boundaries. Consecutive user messages (e.g., pasting logs + follow-up) stay in the same turn.
2. **Filter** — Within each turn, only the user instruction and the first/last substantial assistant reply are kept. Tool call chains in between are discarded.
3. **Score** — Each turn is scored: `user_text_length × (1 + assistant_reply_count)`. Longer instructions with more assistant engagement = higher importance.
4. **Select** — The first turn (requirements) and last two turns (conclusions) are always included. Remaining budget goes to the highest-scored middle turns.
5. **Summarize skipped turns** — Skipped turns are compressed into one-line previews (`[skipped] User: fix the CSS issue with login page...`) so the LLM still sees the conversation's causal chain.

The character budget defaults to 32,000 (~8K tokens) and is configurable via `LLM_MAX_INPUT_CHARS` for users with larger-context models.

### Structured Output

Summarization uses Vercel AI SDK's `generateObject()` with a Zod schema instead of prompt-engineered JSON. This guarantees valid output structure with automatic retry (up to 3 attempts) when schema validation fails — eliminating the truncation and parse failures common with `generateText()` + manual JSON extraction.

## CLI & MCP Server

ChatCrystal also provides a CLI tool and MCP Server, published as an npm package.

```bash
npm install -g chatcrystal
```

### CLI Commands

```bash
crystal status                          # Server status and DB stats
crystal import [--source claude-code]   # Scan and import conversations
crystal search "query" [--limit 10]     # Semantic search
crystal notes list [--tag X]            # Browse notes
crystal notes get <id>                  # View note detail
crystal tags                            # List tags with counts
crystal summarize --all                 # Batch summarize
crystal config get                      # View config
crystal serve -d                        # Start server in background
crystal serve stop                      # Stop background server
```

Auto-start: commands that need the server will auto-launch it in background if not running. Output is TTY-aware — colored tables in terminal, JSON when piped.

### MCP Server

Integrate with AI coding tools (Claude Code, Cursor, etc.) so they can retrieve knowledge from your conversation history during coding.

```bash
crystal mcp                             # Start MCP stdio server
```

**Claude Code configuration** (`settings.json`):
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

MCP exposes 6 tools: read-only knowledge tools `search_knowledge`, `get_note`, `list_notes`, `get_relations`, plus memory-loop tools `recall_for_task` and `write_task_memory`.

Formal portable ChatCrystal skills live under [`skills/`](skills/) and are documented in [`docs/agent-skills.md`](docs/agent-skills.md).

### Memory Loop Architecture

ChatCrystal's agent memory loop is split into three layers:

- **ChatCrystal Core** — Local knowledge storage, retrieval, merge, and writeback
- **MCP Layer** — Stable tools for knowledge lookup plus task recall and task writeback
- **Skill Layer** — Portable skills that trigger recall before substantial work and writeback after meaningful work

When Core is unavailable, the skills degrade safely: they continue helping with the task, but do not pretend memory was recalled or persisted.

See [`docs/agent-skills.md`](docs/agent-skills.md) for installation, full mode, degraded mode, and publishing guidance.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Fastify v5 + TypeScript |
| Frontend | Vite v8 + React 19 + Tailwind CSS v4 + TanStack React Query v5 |
| Desktop | Electron + electron-builder (NSIS installer) |
| Database | sql.js (WASM SQLite) |
| LLM | Vercel AI SDK v6 — Ollama / OpenAI / Anthropic / Google / Azure / Custom |
| Embedding | vectra vector index, multi-provider |
| File watching | chokidar |

## Getting Started

### Prerequisites

- Node.js >= 20
- An LLM service (pick one):
  - [Ollama](https://ollama.ai/) (local inference, free)
  - OpenAI / Anthropic / Google AI API key
  - Any OpenAI-compatible service (OpenRouter, Poe, etc.)

If using Ollama, pull the required models:

```bash
ollama pull qwen2.5:7b          # LLM summarization
ollama pull nomic-embed-text     # Embedding
```

### Installation

```bash
git clone https://github.com/ZengLiangYi/ChatCrystal.git
cd ChatCrystal
npm install
cp .env.example .env             # Edit configuration as needed
```

### Desktop App (Recommended)

```bash
npm run dev:electron             # Dev mode (Electron + Vite HMR)
npm run build:electron           # Build NSIS installer → release/
```

The installer is in the `release/` directory. Data is stored in `%APPDATA%/chatcrystal/data/`.

### Web Dev Mode

```bash
npm run dev                      # Starts backend (3721) + frontend (13721)
```

Visit http://localhost:13721

### Web Production Mode

```bash
npm run build                    # Build backend + frontend
npm start                        # Start server (frontend served statically)
```

Visit http://localhost:3721

## Workflow

1. Click "Import" in the sidebar to scan Claude Code / Codex CLI / Cursor / Trae / GitHub Copilot conversations
2. Browse imported conversations on the Conversations page
3. Click "Summarize" or use "Batch Summarize" to distill conversations into notes
4. Search your knowledge on the Search page; enable "Expand related notes" to follow relation edges
5. Explore note relationships on the Graph page (force-directed, draggable, zoomable)
6. Filter and browse all notes by tag on the Notes page
7. Switch LLM/Embedding providers and models on the Settings page

## Configuration

Configure via `.env` file or the Settings page (hot-swappable at runtime):

```bash
# Server port
PORT=3721

# Data sources
CLAUDE_PROJECTS_DIR=~/.claude/projects
CODEX_SESSIONS_DIR=~/.codex/sessions
# CURSOR_DATA_DIR=          # Auto-detected per platform, can override

# LLM summarization (ollama/openai/anthropic/google/azure/custom)
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434
LLM_MODEL=qwen2.5:7b
# LLM_MAX_INPUT_CHARS=32000   # Increase for large-context models (e.g., 80000 for 128K models)

# Embedding (ollama/openai/google/azure/custom)
EMBEDDING_PROVIDER=ollama
EMBEDDING_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text
```

> **Note: LLM and Embedding must be configured separately.** Semantic search requires a dedicated embedding model that supports the `/v1/embeddings` endpoint. Large language models (Claude, GPT-4, Qwen, etc.) **cannot** be used as embedding models. Common embedding models:
>
> | Provider | Models |
> |----------|--------|
> | Ollama (local) | `nomic-embed-text`, `mxbai-embed-large` |
> | OpenAI | `text-embedding-3-small`, `text-embedding-3-large` |
> | Google | `text-embedding-004` |

### Provider Configuration Examples

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

# OpenAI-compatible service (Poe / OpenRouter / etc.)
LLM_PROVIDER=custom
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=your-key
LLM_MODEL=anthropic/claude-sonnet-4
```

## Project Structure

```
ChatCrystal/
├── electron/                # Electron main process (window, tray, lifecycle)
├── shared/types/            # Shared TypeScript types
├── server/src/
│   ├── db/                  # SQLite schema + utilities
│   ├── parser/              # Plugin-based conversation parsers (Claude Code / Codex / Cursor / Trae / Copilot)
│   ├── services/            # Import, summarization, LLM, embedding, relations, providers
│   ├── routes/              # Fastify API routes
│   ├── watcher/             # chokidar file watching
│   └── queue/               # p-queue task queue + TaskTracker
├── client/src/
│   ├── pages/               # Page components (Dashboard, Conversations, Notes, Search, Graph, Settings)
│   ├── components/          # Shared components (StatusBar, ActivityPanel, etc.)
│   ├── hooks/               # React Query hooks
│   ├── themes/              # Theme definitions
│   └── providers/           # ThemeProvider
├── scripts/                 # Legacy tray scripts (superseded by Electron)
├── electron-builder.yml     # Electron packaging config
└── data/                    # Runtime data (gitignored)
```

## Adding Data Sources

Implement the `SourceAdapter` interface to add a new AI tool:

```typescript
interface SourceAdapter {
  name: string;
  displayName: string;
  detect(): Promise<SourceInfo | null>;
  scan(): Promise<ConversationMeta[]>;
  parse(meta: ConversationMeta): Promise<ParsedConversation>;
}
```

Built-in adapters:

| Adapter | Data Source | Format |
|---|---|---|
| `claude-code` | `~/.claude/projects/**/*.jsonl` | JSONL conversation log |
| `codex` | `~/.codex/sessions/**/rollout-*.jsonl` | JSONL event stream |
| `cursor` | Cursor `workspaceStorage/state.vscdb` | SQLite KV store |
| `trae` | Trae `workspaceStorage/state.vscdb` | SQLite KV store |
| `copilot` | VS Code `workspaceStorage/chatSessions/*.jsonl` | JSONL session snapshots |

Create a new adapter file in `server/src/parser/adapters/` and register it in `parser/index.ts`.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/status` | Server status + statistics |
| GET | `/api/config` | Current configuration (secrets redacted) |
| POST | `/api/config` | Update provider configuration |
| POST | `/api/config/test` | Test LLM connection |
| GET | `/api/providers` | Available provider list |
| POST | `/api/import/scan` | Trigger full scan import |
| GET | `/api/conversations` | Conversation list (filterable, paginated) |
| GET | `/api/conversations/:id` | Conversation detail + messages |
| POST | `/api/conversations/:id/summarize` | Generate summary for one conversation |
| POST | `/api/summarize/batch` | Batch summarization |
| POST | `/api/summarize/reset-errors` | Reset error status |
| GET | `/api/notes` | Note list |
| GET | `/api/notes/:id` | Note detail |
| POST | `/api/notes/:id/embed` | Generate embedding |
| POST | `/api/embeddings/batch` | Batch embedding generation |
| GET | `/api/search?q=...&expand=true` | Semantic search (expand follows relation edges) |
| GET | `/api/notes/:id/relations` | Note relations list |
| POST | `/api/notes/:id/relations` | Create relation manually |
| DELETE | `/api/relations/:id` | Delete relation |
| POST | `/api/notes/:id/discover-relations` | LLM auto-discover relations |
| POST | `/api/relations/batch-discover` | Batch relation discovery |
| GET | `/api/relations/graph` | Knowledge graph data (nodes + edges) |
| GET | `/api/tags` | Tag list |
| GET | `/api/queue/status` | Queue status |
| POST | `/api/queue/cancel` | Cancel queued tasks |

## Knowledge Graph

After generating note summaries, the LLM automatically analyzes relationships between notes. Supported relation types:

| Relation | Meaning | Example |
|----------|---------|---------|
| `CAUSED_BY` | Causation | Login failure ← Token expiration logic bug |
| `LEADS_TO` | Leads to | Route refactor → page flicker bug |
| `RESOLVED_BY` | Resolved by | Memory leak → added cleanup function |
| `SIMILAR_TO` | Similar topic | Two conversations both discussing deployment |
| `CONTRADICTS` | Contradiction | Use Redux vs Context is enough |
| `DEPENDS_ON` | Dependency | New feature depends on auth middleware refactor |
| `EXTENDS` | Extension | Added eviction policy on top of caching solution |
| `REFERENCES` | Reference | Conversation mentions a previous architecture decision |

View related notes at the bottom of the note detail page. Supports AI discovery, manual addition, and search-to-link. Browse the entire knowledge network via the force-directed graph on the Graph page.

## FAQ

**Semantic search returns 500 "Not Found"**

Embedding model misconfigured. Make sure `EMBEDDING_MODEL` is a dedicated embedding model (e.g., `nomic-embed-text`), not a large language model (e.g., `claude-haiku`, `qwen2.5`). LLMs do not support the `/v1/embeddings` endpoint.

**Can't connect to Ollama on startup**

Make sure Ollama is running and the models are pulled:
```bash
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

**No conversations after import**

Check that `CLAUDE_PROJECTS_DIR` in `.env` points to the correct path and contains `.jsonl` files.

**Knowledge graph is empty**

You need to generate notes first, then click "Discover" on a note detail page, or use `POST /api/relations/batch-discover` for batch discovery.

## License

[MIT](LICENSE)
