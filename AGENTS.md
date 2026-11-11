# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

ChatCrystal is an AI conversation knowledge crystallization tool. It imports conversations from 32 AI agent harnesses (Claude Code, Claude Desktop, Codex CLI, Cursor, Trae, GitHub Copilot, Copilot CLI, Gemini CLI, Qwen Code, OpenCode, Cline, Roo Code, Kilo Code, Continue, DeepSeek Harness, WorkBuddy, CodeBuddy, Antigravity, Droid, Goose, Pi, omp, Raft, Cindy, Qoder, Qoder CN, ZCode, Hermes, Alma, Grok Build, Kimi Code, MiniMax Code), reads them locally **and from WSL distros on Windows**, uses LLM to generate structured notes (title, summary, key conclusions, code snippets, tags), and provides semantic search via embeddings. The UI is in Simplified Chinese.

## Commands

```bash
# Install (Node.js 24; root workspace uses pnpm via Corepack)
corepack enable
pnpm install

# Development (server port 3721 + client port 13721)
pnpm dev

# Build for production
pnpm build

# Production server (serves frontend statically on port 3721)
pnpm start

# Electron desktop app
pnpm dev:electron        # dev mode (Vite HMR + Electron window)
pnpm build:electron      # build NSIS installer → release/
pnpm pack:electron       # build unpacked directory (faster for testing)

# Release (bump version + git tag + push → CI builds & publishes)
pnpm release             # patch bump (0.1.0 → 0.1.1)
pnpm release -- minor    # minor bump
pnpm release -- major    # major bump
pnpm release -- 1.0.0    # explicit version
pnpm release:electron -- 1.0.1  # Electron-only release → electron-v*
pnpm release:npm -- 1.0.1       # npm-only release → npm-v*

# Lint
pnpm lint
pnpm lint:fix

# Tests (all layers by default)
pnpm test
pnpm test:server
pnpm test:client
pnpm test:electron
pnpm --filter ./server smoke:mcp  # requires pnpm build first

# Dependency security
pnpm security:audit
pnpm security:signatures
```

### Release Tag Semantics

Use `scripts/release.mjs` for releases; do not manually bump versions, commit, tag, and push unless the user explicitly asks for a custom recovery flow.

- `v*` tags are full releases and trigger both npm publishing and Electron GitHub Release builds. Use this only when both root `package.json` and `server/package.json` should move together.
- `electron-v*` tags are Electron-only releases. Use `pnpm release:electron -- <version>` for desktop-only changes, including Electron main/preload/tray/packaging changes and Electron-gated client UI.
- `npm-v*` tags are npm-only releases. Use `pnpm release:npm -- <version>` for CLI/server/MCP package changes.
- The published npm package version comes from `server/package.json`, not the root package. If a `v*` tag is pushed while `server/package.json` still points at an already-published version, the npm job will fail with `E403 You cannot publish over the previously published versions`.
- If an Electron-only release is accidentally published with a `v*` tag and the Electron job succeeds but npm fails because the server version already exists, do not delete or re-tag the release by default. Treat the GitHub Release as usable, document the cause, and use `electron-v*` for the next Electron-only release.

### CLI (`crystal`)

Install globally: `npm install -g chatcrystal`

```bash
# Core commands
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

MCP exposes 6 tools: read-only knowledge tools `search_knowledge`, `get_note`, `list_notes`, `get_relations`, plus memory-loop tools `recall_for_task` and `write_task_memory`.

## Architecture

Monorepo with three npm workspaces:

### `shared/` — Shared Types (`@chatcrystal/shared`)
- No build step; exports TypeScript types directly from `types/index.ts`

### `server/` — Fastify Backend (`@chatcrystal/server`)
- **Runtime:** tsx (dev + prod)
- **Framework:** Fastify v5 with CORS and static file serving (production SPA fallback)
- **Database:** `node:sqlite` (Node.js 24 built-in SQLite) with WAL, stored under the active runtime data directory as `chatcrystal.db`. Saves are WAL checkpoints instead of the old sql.js whole-file snapshot; parser-side SQLite readers (Cursor, Trae, OpenCode, ZCode, Goose, Hermes, Alma) still open their own databases with sql.js.
- **Key modules:**
  - `db/` — Schema (7 tables), utils (`resultToObjects`)
  - `parser/` — Plugin architecture via `SourceAdapter`; 32 built-in adapters registered in `parser/index.ts`. Source ids live in `ALL_SOURCE_NAMES` (`config.ts`) and drive `enabledSources` migration and remote-import validation.
    - JSONL families: `claude-code` (`~/.claude/projects/`), `codex` (`~/.codex/sessions/` + `archived_sessions/`, old and 0.160+ formats, plain or multi-frame zstd), `copilot-cli` (`~/.copilot/session-state/*/events.jsonl`), `droid` (`~/.factory/sessions/**/*.jsonl`), `qwen` (`~/.qwen/projects/*/chats/*.jsonl`, Claude-style), `workbuddy` (`~/.workbuddy(-ai)/projects/*/*.jsonl`, OpenAI Agents items), `codebuddy` (`~/.codebuddy/projects/*`, same items), `qoder`/`qoder-cn` (`~/.qoder(-cn)/projects/*`, Claude-style), `claude-desktop` (Claude Desktop Cowork/local-agent `.claude` trees, Claude-style), `pi` (`~/.pi/agent/sessions/*`), `omp` (`~/.omp/agent` + profiles), `raft` (`~/.slock/agents/*/.pi-sessions|.builtin-sessions`), `cindy` (`<config>/Cindy*/pi-agent-home/sessions`), `grok` (`~/.grok/sessions/<cwd>/<id>/updates.jsonl`), `kimi` (`~/.kimi-code/sessions/*/*/agents/main/wire.jsonl`), `minimax-code` (`~/.minimax/v2/sessions/**/messages*.jsonl`), `antigravity` (`~/.gemini/antigravity` + CLI `.gemini/antigravity-cli` brain logs), `gemini` (`~/.gemini/tmp/*/chats/session-*.{json,jsonl}`).
    - JSONL with multi-frame zstd: `dsh` (`~/.dsh/sessions/**/session.v<N>.jsonl[.zstd]`; see `parser/zstd.ts`).
    - Whole-file JSON: `continue` (`~/.continue/sessions/*.json`), `cline` (CLI sessions + VS Code extension `tasks/*`), `roo`/`kilo` (VS Code extension `tasks/*`; shared `parser/adapters/vscode-tasks.ts`).
    - SQLite: `cursor`/`trae` (`state.vscdb`), `opencode` (`opencode.db`, v1/v2 schema + legacy JSON storage), `zcode` (`~/.zcode/cli/db/db.sqlite`, OpenCode schema), `goose` (`sessions/sessions.db`, or legacy JSONL), `hermes` (`~/.hermes/state.db`), `alma` (`<config>/alma/chat_threads.db`), `copilot` (VS Code chatSession snapshots).
    - Adapters that support live import expose `watchPaths()`; `watcher/` maps changed folders to their sources and asks the background sync engine for a targeted sync (it starts only after the first startup pass, so chokidar's initial scan cannot starve it).
    - WSL (Windows): file-based adapters scan each running WSL distro home as an extra root through `parser/wsl.ts` + `parser/sourceRoots.ts` (`withWslRoots(primary, '.codex/sessions')`), set `ConversationMeta.rootDir`, and read root-level metadata with `meta.rootDir ?? appConfig.<primary>`. WSL and VS Code Remote (`.vscode-server/data/User`) sessions are imported on manual Import; the watcher only watches local Windows paths.
  - `services/llm.ts` — Provider factory via Vercel AI SDK (Ollama, OpenAI, OrcaRouter, Anthropic, Google, Azure, Custom)
  - `services/summarize.ts` — Conversation preprocessing (truncate ~8000 tokens) + LLM call + JSON parsing + DB persistence. Auto-generates embeddings after summarization.
  - `services/embedding.ts` — Embedding model factory + vectra LocalIndex + text chunking
  - `routes/` — REST endpoints: status, config, import, sync, conversations CRUD, notes CRUD, tags, search, queue status, batch operations
  - `queue/` — p-queue singleton (concurrency=1, 1 req/sec, 429 retry)
  - `services/import.ts` — index-first incremental import: detect → scan (rows made visible as `transcript_status = 'pending'` before parsing) → parse via the transcript cache/worker pool → dedup by size/mtime/content hash → insert/replace. Emits phase and per-source progress, supports `sources` filtering and `AbortSignal` cancellation, and exports `materializeConversationById()` for index-only rows.
  - `services/transcript-cache.ts` — parsed `ParsedConversation` snapshots on disk (`<dataDir>/transcript-cache/<source>/<sha1>.json.gz`, gzip, keyed by source/id/parserVersion/filePath/fileSize/fileMtime/rootDir) with size/age pruning; the detail route and summarizer materialize pending conversations through it.
  - `services/sync.ts` — background sync state machine (`idle`/`syncing`/`cancelled`/`error`, per-source progress, pending-trigger merging). `syncManager` is the process-wide singleton; `createServer` schedules a startup pass and the watcher feeds it. Exposed as `GET /api/sync/status`, `POST /api/sync/start`, `POST /api/sync/cancel`, `GET /api/sync/stream` (SSE).
  - `services/parse-pool.ts` — worker-thread parser pool used by `importAll` by default (`CHATCRYSTAL_PARSE_WORKERS`, `0`/`CHATCRYSTAL_PARSE_POOL=off` parses in-process; tests always parse inline).
  - `watcher/` — chokidar watches every adapter's `watchPaths()` plus the legacy source dirs, after the first startup sync; events are debounced (1.8s), mapped to the owning source by longest-prefix and handed to `syncManager.requestSources`. WSL UNC paths are never watched.

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
- `main.ts` — Main process: single-instance lock, port detection, Fastify server startup (embedded, with background sync and the file watcher enabled), BrowserWindow creation, system tray, window state persistence
- `preload.ts` — Minimal contextBridge exposing `electronAPI.isElectron` and version info
- `tray.ts` — System tray icon + context menu (open window, open in browser, quit)
- `icon.svg/png/ico` — Application icon (crystal gem + chat bubble)
- **Lifecycle:** Window close → hide to tray; tray quit → graceful shutdown (watcher stop → DB save → Fastify close → tray destroy)
- **Data directory:** `~/.chatcrystal/data` by default, shared with CLI and MCP. `DATA_DIR` can override it explicitly.
- **Environment vars set by Electron:** `ELECTRON=true`, `DATA_DIR`, `ELECTRON_PACKAGED` (packaged only)
- **Server import:** Production uses dynamic `import()` via `file://` URL to load compiled server ESM
- **Packaging:** `electron-builder.yml` → NSIS installer, `sql-wasm.wasm` as extraResource, aggressive node_modules filtering

### `scripts/` — Release & Utility Scripts
- `release.mjs` — Release helper for version bump / tag / push flows
- `seed-demo.mjs` — Demo data seeding helper

## Data Flow

```
~/.claude/projects/**/*.jsonl       → Claude Code Adapter (JSONL parse + sanitize)
~/.codex/sessions|archived_sessions/** → Codex Adapter (event stream, plain/zstd)
Cursor workspaceStorage/state.vscdb → Cursor Adapter (SQLite KV → messages)
Trae workspaceStorage/state.vscdb   → Trae Adapter (SQLite KV → agent task content)
Code workspaceStorage/chatSessions  → Copilot Adapter (JSONL session snapshots)
~/.gemini/tmp/*/chats/*             → Gemini CLI Adapter (session JSON / replay JSONL)
~/.qwen/projects/*/chats/*.jsonl    → Qwen Code Adapter (Claude-style JSONL)
~/.local/share/opencode/            → OpenCode Adapter (SQLite v1/v2 or legacy JSON)
<VS Code User>/globalStorage/*/tasks → Cline / Roo / Kilo Adapters (whole-file JSON)
~/.copilot/session-state/*/*.jsonl  → Copilot CLI Adapter (event JSONL)
~/.continue/sessions/*.json         → Continue Adapter (whole-file JSON)
~/.dsh/sessions/**/*.jsonl[.zstd]   → DeepSeek Harness Adapter (zstd frames → events)
~/.workbuddy(-ai)/projects/*/*.jsonl→ WorkBuddy Adapter (OpenAI Agents items)
~/.gemini/antigravity/brain/*/logs  → Antigravity Adapter (step JSONL)
~/.factory/sessions/**/*.jsonl      → Droid Adapter (event JSONL)
~/.local/share/goose/sessions/      → Goose Adapter (SQLite or legacy JSONL)
~/.claude | .codex | ... under WSL   → same adapters scan each WSL distro home as an extra root
~/.pi/agent/sessions/*              → Pi Adapter (JSONL entries)
~/.omp/agent (+profiles)            → omp Adapter (Pi format + titles)
~/.slock/agents/*/.pi-sessions      → Raft Adapter (Pi format)
<Cindy>/pi-agent-home/sessions      → Cindy Adapter (Pi format)
~/.qoder(-cn)/projects/*            → Qoder / Qoder CN Adapters (Claude-style JSONL)
~/.codebuddy/projects/*             → CodeBuddy Adapter (WorkBuddy items)
%APPDATA%/Claude/.../local_*/.claude → Claude Desktop Adapter (Claude-style JSONL)
~/.zcode/cli/db/db.sqlite           → ZCode Adapter (OpenCode schema)
~/.hermes/state.db                  → Hermes Adapter (SQLite)
<config>/alma/chat_threads.db       → Alma Adapter (SQLite)
~/.grok/sessions/<cwd>/<id>         → Grok Build Adapter (updates.jsonl)
~/.kimi-code/sessions/*/*/agents/main → Kimi Code Adapter (wire.jsonl)
~/.minimax/v2/sessions/**           → MiniMax Code Adapter (messages*.jsonl)
  → Import Service (dedup by id+source, insert)
  → SQLite
  → Fastify REST API
  → React client (React Query hooks)

Summarization:
  Conversation → prepareTranscript (truncate) → generateText (AI SDK) → extractJSON → saveNote → generateEmbeddings → vectra index

Search:
  Query → embed(query) → vectra.queryItems → deduplicate by noteId → enrich with tags
```

## Configuration

Runtime configuration is stored in `config.json` under the active data directory. CLI, MCP, repo/dev checkouts, npm global installs, and Electron default to `~/.chatcrystal/data`; `DATA_DIR` can override that explicitly. `.env.example` is only an optional local override template. Key override variables:
- `PORT` (default 3721)
- `CLAUDE_PROJECTS_DIR` — path to Claude Code projects
- `CODEX_SESSIONS_DIR` — path to Codex CLI sessions
- `CURSOR_DATA_DIR` — path to Cursor data (auto-detected per platform)
- `TRAE_DATA_DIR` — path to Trae data (auto-detected per platform)
- `COPILOT_DATA_DIR` — path to VS Code Copilot data (auto-detected per platform)
- `GEMINI_DATA_DIR` — Gemini CLI home (default `~/.gemini`)
- `QWEN_DATA_DIR` — Qwen Code home (default `~/.qwen`)
- `OPENCODE_DATA_DIR` — OpenCode data dir (default `~/.local/share/opencode`)
- `CLINE_DATA_DIR` / `CLINE_EXT_DATA_DIR` — Cline CLI data / VS Code extension globalStorage
- `ROO_DATA_DIR` / `KILO_DATA_DIR` — Roo Code / Kilo Code extension globalStorage dirs
- `COPILOT_CLI_DATA_DIR` — GitHub Copilot CLI home (default `~/.copilot`)
- `CONTINUE_DATA_DIR` — Continue home (default `~/.continue`)
- `DSH_SESSIONS_DIR` — DeepSeek Harness sessions (default `~/.dsh/sessions`)
- `WORKBUDDY_DATA_DIR` / `WORKBUDDY_AI_DATA_DIR` — WorkBuddy / WorkBuddy AI homes
- `ANTIGRAVITY_DATA_DIR` — Antigravity data (default `~/.gemini/antigravity`)
- `DROID_DATA_DIR` — Factory Droid home (default `~/.factory`)
- `GOOSE_DATA_DIR` — Goose data dir (default platform-specific)
- `VSCODE_USER_DIR` — VS Code per-user data folder, used to locate extension task stores
- `PI_CODING_AGENT_DIR` — Pi agent folder (default `~/.pi/agent`)
- `OMP_DATA_DIR` — omp agent folder (default `~/.omp/agent`)
- `SLOCK_HOME` — Raft folder (default `~/.slock`)
- `CINDY_CONFIG_DIR` — platform config folder containing `Cindy`/`CindyGlobal`
- `QODER_CONFIG_DIR` / `QODERCN_CONFIG_DIR` — Qoder / Qoder CN homes
- `CODEBUDDY_CONFIG_DIR` — CodeBuddy Code home (default `~/.codebuddy`)
- `CLAUDE_DESKTOP_DATA_DIR` — Claude Desktop data folder (default `<config>/Claude`)
- `ZCODE_HOME` / `HERMES_HOME` / `GROK_HOME` / `KIMI_CODE_HOME` / `MINIMAX_DATA_DIR` — ZCode / Hermes / Grok Build / Kimi Code / MiniMax Code homes
- `ALMA_DATA_DIR` — Alma data folder (default `<config>/alma`)
- `CHATCRYSTAL_WSL` — set to `0`/`false`/`off` to disable WSL session discovery
- `CHATCRYSTAL_WSL_DISTROS` — comma-separated WSL distros to read (they may be started on access); default is only running distros
- `CHATCRYSTAL_WSL_HOMES` — semicolon-separated forced homes (also used by tests)
- `CHATCRYSTAL_AUTO_SYNC` — set to `0` to disable the startup/watcher background sync (manual `POST /api/sync/start` and `crystal import` still work)
- `CHATCRYSTAL_PARSE_WORKERS` — worker-thread parser count (default `min(4, cpus-1)`; `0` parses in-process)
- `CHATCRYSTAL_PARSE_POOL` — set to `off`/`0`/`false` to force in-process parsing (alias of `CHATCRYSTAL_PARSE_WORKERS=0`)
- `CHATCRYSTAL_TRANSCRIPT_CACHE` — set to `off`/`0`/`false` to disable the parsed-transcript disk cache
- `CHATCRYSTAL_TRANSCRIPT_CACHE_DIR` — cache folder (default `<dataDir>/transcript-cache`)
- `CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_MB` / `CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_AGE_DAYS` — cache caps (default 512 MB / 30 days)
- `LLM_PROVIDER` / `LLM_MODEL` — for summarization (ollama, openai, orcarouter, anthropic, google, azure, custom)
- `EMBEDDING_PROVIDER` / `EMBEDDING_MODEL` — for semantic search

> **注意：LLM 与 Embedding 需要分别配置。** 语义搜索要求 Embedding 模型支持 `/v1/embeddings` 端点。大语言模型（如 Codex、GPT-4、Qwen）**不能**用作 Embedding 模型。常见可用的 Embedding 模型：
> - Ollama（本地）：`nomic-embed-text`、`mxbai-embed-large`
> - OpenAI：`text-embedding-3-small`、`text-embedding-3-large`
> - Google：`text-embedding-004`
>
> 如果语义搜索返回 500 "Not Found"，通常是 Embedding 模型配置错误导致的。

## Key Patterns

- **SourceAdapter plugin interface** (`parser/adapter.ts`): implement `detect()`, `scan()`, `parse()` and optional `watchPaths()` to add new sources. 32 adapters ship today (all 26 magpie session readers plus Trae, Copilot Chat/CLI, Roo, Kilo, Continue, Goose, Qwen and zcode extras); the id list lives in `ALL_SOURCE_NAMES` (`server/src/config.ts`) and must match `server/src/parser/index.ts`. New source tests set their data-dir env var before importing the adapter so `appConfig` picks the fixture root. File-based adapters that can run in WSL scan `withWslRoots(primary, '<distro-home-relative>')` and tag metas with `rootDir`; tests set `CHATCRYSTAL_WSL='0'` and inject fixtures via `setWslHomesForTesting()`.
- **Shared types are the contract**: both server and client import from `@chatcrystal/shared`
- **No ORM**: raw SQL via `node:sqlite` with parameterized queries
- **Index-first import**: during collection every scanned file becomes a `conversations` row with `transcript_status = 'pending'` before parsing, so the list fills as soon as a scan completes. The import loop (or the detail page via `materializeConversationById`) writes the messages and flips the row to `'materialized'`; interrupted syncs leave pending rows that materialize on demand. Parsed transcripts are cached on disk (`services/transcript-cache.ts`) and reused by both paths.
- **Background sync is the import UX**: `syncManager` (services/sync.ts) owns the only import pass; the watcher and startup schedule feed it targeted source lists, and the client renders its state instead of running a one-shot import. `importAll()` still supports the old callback form for the CLI/SSE route.
- **Parsing scales with worker threads**: `importAll` defaults to the shared `parse-pool.ts`; in the Node test runner it parses inline because fake adapters are registered in-process (`NODE_TEST_CONTEXT`).
- **DB is a real SQLite file now**: WAL + checkpointed saves (`saveDatabase()`); a backup/copy must include `chatcrystal.db-wal` if taken while the server is running.
- **sanitizeContent()**: strips Claude Code system XML tags from message content
- **Consecutive tool-use messages**: grouped and collapsed in frontend (ToolCallGroup component)
- **Production SPA fallback**: Fastify serves `client/dist`, non-API 404s return `index.html`
- **Dual mode**: `pnpm start` runs standalone web server; Electron embeds the same server in its main process via `createServer()` export
- **Window state persistence**: Electron saves/restores window bounds (position, size, maximized) to `%APPDATA%/ChatCrystal/window-state.json`
- **Single instance**: `app.requestSingleInstanceLock()` prevents duplicate instances; second launch focuses existing window
