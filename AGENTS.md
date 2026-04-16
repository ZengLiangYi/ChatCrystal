# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

ChatCrystal is an AI conversation knowledge crystallization tool. It imports conversations from AI coding tools (currently Codex), uses LLM to generate structured notes (title, summary, key conclusions, code snippets, tags), and provides semantic search via embeddings. The UI is in Simplified Chinese.

## Commands

```bash
# Development (server port 3721 + client port 13721)
npm run dev

# Build for production
npm run build

# Production server (serves frontend statically on port 3721)
npm start

# Electron desktop app
npm run dev:electron        # dev mode (Vite HMR + Electron window)
npm run build:electron      # build NSIS installer → release/
npm run pack:electron       # build unpacked directory (faster for testing)

# Release (bump version + git tag + push → CI builds & publishes)
npm run release             # patch bump (0.1.0 → 0.1.1)
npm run release -- minor    # minor bump
npm run release -- major    # major bump
npm run release -- 1.0.0    # explicit version

# System tray (legacy, replaced by Electron tray)
npm run tray                # with console
npm run tray:silent         # silent (VBS launcher)

# Lint
npm run lint
npm run lint:fix
```

### CLI (`crystal`)

Install globally: `npm install -g chatcrystal`

```bash
# Core commands
crystal status                          # Server status and DB stats
crystal import [--source Codex]   # Scan and import conversations
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

# Server management
crystal serve                           # Start server (foreground)
crystal serve -d                        # Start server (daemon)
crystal serve stop                      # Stop daemon
crystal serve status                    # Check if running

# MCP Server (for AI tool integration)
crystal mcp                             # Start MCP stdio server
```

Global options: `--base-url` (server URL), `--json` (force JSON output), `--version`.

Auto-start: commands that need the server will auto-launch it in background if not running.

#### MCP Configuration

Codex (`settings.json`):
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

MCP exposes 4 read-only tools: `search_knowledge`, `get_note`, `list_notes`, `get_relations`.

## Architecture

Monorepo with three npm workspaces:

### `shared/` — Shared Types (`@chatcrystal/shared`)
- No build step; exports TypeScript types directly from `types/index.ts`

### `server/` — Fastify Backend (`@chatcrystal/server`)
- **Runtime:** tsx (dev + prod)
- **Framework:** Fastify v5 with CORS and static file serving (production SPA fallback)
- **Database:** sql.js (WASM SQLite) at `data/chatcrystal.db`, auto-saved every 30s
- **Key modules:**
  - `db/` — Schema (7 tables), utils (`resultToObjects`)
  - `parser/` — Plugin architecture via `SourceAdapter`. Five built-in adapters:
    - `adapters/Codex.ts` — JSONL from `~/.Codex/projects/`. Sanitizes `<system-reminder>`, `<command-name>` tags.
    - `adapters/codex.ts` — JSONL event stream from `~/.codex/sessions/`. Reconstructs conversation from event_msg/response_item events.
    - `adapters/cursor.ts` — SQLite `state.vscdb` from Cursor's workspaceStorage/globalStorage. Reads composer metadata + bubble data via sql.js.
    - `adapters/trae.ts` — SQLite `state.vscdb` from Trae's workspaceStorage. Reads `memento/icube-ai-agent-storage` key; extracts content from agentTaskContent for agent responses.
    - `adapters/copilot.ts` — JSONL from VS Code's workspaceStorage/chatSessions + globalStorage/emptyWindowChatSessions. Parses session snapshots (kind:0) with requests/response arrays.
  - `services/llm.ts` — Provider factory: Ollama/OpenAI/Custom via Vercel AI SDK
  - `services/summarize.ts` — Conversation preprocessing (truncate ~8000 tokens) + LLM call + JSON parsing + DB persistence. Auto-generates embeddings after summarization.
  - `services/embedding.ts` — Embedding model factory + vectra LocalIndex + text chunking
  - `services/import.ts` — Scan + dedup (file size + mtime) + batch insert
  - `routes/` — REST endpoints: status, config, import, conversations CRUD, notes CRUD, tags, search, queue status, batch operations
  - `queue/` — p-queue singleton (concurrency=1, 1 req/sec, 429 retry)
  - `watcher/` — chokidar watches all data source paths (Codex JSONL, Codex sessions JSONL, Cursor global vscdb), debounced auto-import

### `client/` — React SPA
- **Build:** Vite v8 + `@vitejs/plugin-react`
- **Styling:** Tailwind CSS v4 via `@tailwindcss/vite`. Custom utility classes in `index.css` reference CSS variables injected by ThemeProvider.
- **State:** TanStack React Query v5; React Context for theming
- **Routing:** React Router v7. Pages: Dashboard, Conversations, ConversationDetail, Notes, NoteDetail, Search, Settings
- **Components:** MarkdownRenderer (react-markdown + remark-gfm + react-syntax-highlighter/Prism), ToolCallGroup (collapsible), Layout, Sidebar
- **Path alias:** `@/` maps to `client/src/`
- **Theming:** Runtime CSS variable injection. Theme: `dark-workshop`

### `electron/` — Electron Desktop App
- **Not an npm workspace** — compiled separately via `tsc -p electron/tsconfig.json`
- `main.ts` — Main process: single-instance lock, port detection, Fastify server startup (embedded), BrowserWindow creation, system tray, window state persistence, data migration
- `preload.ts` — Minimal contextBridge exposing `electronAPI.isElectron` and version info
- `tray.ts` — System tray icon + context menu (open window, open in browser, quit)
- `icon.svg/png/ico` — Application icon (crystal gem + chat bubble)
- **Lifecycle:** Window close → hide to tray; tray quit → graceful shutdown (watcher stop → DB save → Fastify close → tray destroy)
- **Data directory:**
  - Dev mode: `./data` (project root)
  - Packaged: `%APPDATA%/ChatCrystal/data` (auto-migrates from old `data/` on first launch)
- **Environment vars set by Electron:** `ELECTRON=true`, `DATA_DIR`, `ELECTRON_PACKAGED` (packaged only)
- **Server import:** Production uses dynamic `import()` via `file://` URL to load compiled server ESM
- **Packaging:** `electron-builder.yml` → NSIS installer, `sql-wasm.wasm` as extraResource, aggressive node_modules filtering

### `scripts/` — Legacy System Tray & Launchers
- `tray.ps1` — PowerShell WinForms NotifyIcon tray app (superseded by Electron tray)
- `start-silent.vbs` — VBS wrapper for hidden launch

## Data Flow

```
~/.Codex/projects/**/*.jsonl       → Codex Adapter (JSONL parse + sanitize)
~/.codex/sessions/**/*.jsonl        → Codex Adapter (event stream → conversation)
Cursor workspaceStorage/state.vscdb → Cursor Adapter (SQLite KV → messages)
Trae workspaceStorage/state.vscdb   → Trae Adapter (SQLite KV → agent task content)
Code workspaceStorage/chatSessions  → Copilot Adapter (JSONL session snapshots)
  → Import Service (dedup by id+source, insert)
  → SQLite
  → Fastify REST API
  → React client (React Query hooks)

Summarization:
  Conversation → prepareTranscript (truncate) → generateText (AI SDK) → extractJSON → saveNote → generateEmbeddings → vectra index

Search:
  Query → embed(query) → vectra.queryItems → deduplicate by noteId → enrich with tags
```

## Environment

Copy `.env.example` to `.env`. Key variables:
- `PORT` (default 3721)
- `CLAUDE_PROJECTS_DIR` — path to Codex projects
- `CODEX_SESSIONS_DIR` — path to Codex CLI sessions
- `CURSOR_DATA_DIR` — path to Cursor data (auto-detected per platform)
- `TRAE_DATA_DIR` — path to Trae data (auto-detected per platform)
- `COPILOT_DATA_DIR` — path to VS Code Copilot data (auto-detected per platform)
- `LLM_PROVIDER` / `LLM_MODEL` — for summarization (ollama, openai, anthropic, google, custom)
- `EMBEDDING_PROVIDER` / `EMBEDDING_MODEL` — for semantic search

> **注意：LLM 与 Embedding 需要分别配置。** 语义搜索要求 Embedding 模型支持 `/v1/embeddings` 端点。大语言模型（如 Codex、GPT-4、Qwen）**不能**用作 Embedding 模型。常见可用的 Embedding 模型：
> - Ollama（本地）：`nomic-embed-text`、`mxbai-embed-large`
> - OpenAI：`text-embedding-3-small`、`text-embedding-3-large`
> - Google：`text-embedding-004`
>
> 如果语义搜索返回 500 "Not Found"，通常是 Embedding 模型配置错误导致的。

## Key Patterns

- **SourceAdapter plugin interface** (`parser/adapter.ts`): implement `detect()`, `scan()`, `parse()` to add new sources. Currently 5 adapters: Codex (JSONL), codex (JSONL events), cursor (SQLite vscdb), trae (SQLite vscdb), copilot (JSONL sessions)
- **Shared types are the contract**: both server and client import from `@chatcrystal/shared`
- **No ORM**: raw SQL via sql.js with parameterized queries
- **sanitizeContent()**: strips Codex system XML tags from message content
- **Consecutive tool-use messages**: grouped and collapsed in frontend (ToolCallGroup component)
- **Production SPA fallback**: Fastify serves `client/dist`, non-API 404s return `index.html`
- **Dual mode**: `npm start` runs standalone web server; Electron embeds the same server in its main process via `createServer()` export
- **Window state persistence**: Electron saves/restores window bounds (position, size, maximized) to `%APPDATA%/ChatCrystal/window-state.json`
- **Single instance**: `app.requestSingleInstanceLock()` prevents duplicate instances; second launch focuses existing window
