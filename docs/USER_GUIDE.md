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
corepack enable
pnpm install
pnpm dev
```

Development mode starts the API server on http://localhost:3721 and the Vite client on http://localhost:13721.

### Desktop App

Download the Windows installer from [GitHub Releases](https://github.com/ZengLiangYi/ChatCrystal/releases) and launch it. To build it locally:

```bash
pnpm dev:electron
pnpm build:electron
```

The installer is generated under `release/`. On first launch, onboarding asks whether to connect a **local core** (recommended; everything stays on this machine) or an existing **cloud core** (URL + access token). Choose the local core, skip the optional import/summary/MCP steps, and open the app — the startup sync then runs automatically.

The desktop app uses the same default data directory as the CLI and MCP server: `~/.chatcrystal/data`.

## Workflow

1. ChatCrystal syncs your local history automatically — a startup pass runs a few seconds after launch and file changes trigger targeted syncs, so there is no import step. The sidebar shows the sync state (waiting / syncing with progress / last synced) and lets you trigger or cancel a pass manually. All 32 agent harnesses are detected, including Claude Code, Claude Desktop, Codex CLI, Cursor, Trae, GitHub Copilot Chat and CLI, Gemini CLI, Qwen Code, OpenCode, Cline, Roo Code, Kilo Code, Continue, DeepSeek Harness, WorkBuddy, CodeBuddy, Antigravity, Droid, Goose, Pi, omp, Raft, Cindy, Qoder/Qoder CN, ZCode, Hermes, Alma, Grok Build, Kimi Code, and MiniMax Code (WSL distro homes on Windows included).
2. Browse raw conversations on the **Conversations** page.
3. Click **Summarize** or run batch summarization to create notes.
4. Search on the **Search** page; enable related-note expansion when you want broader context.
5. Open the graph view to explore tag-based knowledge points and the notes behind each tag.
6. Use the **Settings** page to switch LLM and embedding providers.

### Sync states, indexing, and lazy transcripts

- **Index-first list.** As soon as a source scan finishes, every session file appears as a conversation row, even while its transcript is still parsing. Rows that are not parsed yet show an **Indexing** marker next to the title and are still clickable.
- **Lazy detail.** Opening an indexing row parses that transcript on demand (usually well under a second locally, longer for very large or WSL-hosted files) and then renders the full conversation. The marker disappears once the row is materialized.
- **Cancelling keeps progress.** Click **Cancel** in the sidebar to stop a pass. Index rows and already-parsed conversations stay; click **Retry** to resume, or open a pending conversation to materialize just that one.
- **The watcher is incremental.** It starts after the first startup pass and then triggers small per-source syncs when session files change. Quitting the app stops sync; hiding the window to the tray does not.
- **The first run is the expensive one.** A large history is parsed once; later starts only parse new or changed sessions.

### WSL sessions (Windows)

Agents installed inside a WSL distro keep their history in the distro home. On Windows, ChatCrystal reads those over `\\wsl.localhost` and imports Claude Code, Codex, Gemini CLI, Qwen Code, OpenCode, Cline, Roo Code, Kilo Code, Continue, DeepSeek Harness and other supported agents from your WSL distros.

- Only **running** distros are scanned by default, so a stopped distro is never started just to import. Set `CHATCRYSTAL_WSL_DISTROS=Ubuntu-24.04` to opt specific distros in, or `CHATCRYSTAL_WSL=0` to disable WSL scanning.
- The startup sync and manual syncs pick up WSL and VS Code Remote sessions; the live file watcher only watches the local Windows folders, and changes inside a running WSL distro are seen on the next startup or manual sync.
- The first sync of a large WSL history (for example Codex sessions) can take a little longer because `\\wsl.localhost` reads are slower than local disk; it runs in the background, so you can browse conversations as they arrive.
- `CHATCRYSTAL_AUTO_SYNC=0` disables the automatic startup/watcher passes if you prefer to sync only on demand.

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

The desktop app needs no manual import; `crystal import` remains useful for CLI/CI workflows and for uploading local history to a cloud instance. Commands that need the server can auto-start it in the background when it is not running. Terminal output is TTY-aware: tables for interactive terminals, JSON when piped.

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
  "enabledSources": [
    "claude-code", "codex", "cursor", "trae", "copilot",
    "gemini", "qwen", "opencode", "cline", "roo", "kilo",
    "copilot-cli", "continue", "dsh", "workbuddy", "antigravity", "droid", "goose",
    "pi", "omp", "raft", "cindy", "qoder", "qoder-cn", "codebuddy", "claude-desktop",
    "zcode", "hermes", "alma", "grok", "kimi", "minimax-code"
  ]
}
```

### Sync, parsing and cache

Optional environment variables that tune the background sync pipeline:

| Variable | Default | Description |
|---|---|---|
| `CHATCRYSTAL_AUTO_SYNC` | enabled | Set to `0` to disable startup and watcher syncs; manual sync and `crystal import` still work. |
| `CHATCRYSTAL_PARSE_WORKERS` | `min(4, CPUs-1)` | Worker threads used to parse transcripts; `0` parses in-process. |
| `CHATCRYSTAL_TRANSCRIPT_CACHE` | enabled | `off` disables the parsed-transcript cache. |
| `CHATCRYSTAL_TRANSCRIPT_CACHE_DIR` | `<dataDir>/transcript-cache` | Cache folder. |
| `CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_MB` | `512` | Cache size cap; oldest entries are pruned first. |
| `CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_AGE_DAYS` | `30` | Cache age cap. |
| `CHATCRYSTAL_WSL` / `CHATCRYSTAL_WSL_DISTROS` | running distros | WSL scanning controls (see above). |

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

# OrcaRouter
LLM_PROVIDER=orcarouter
LLM_API_KEY=sk-orca-...
LLM_MODEL=<model-id>

# OpenAI-compatible service
LLM_PROVIDER=custom
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=your-key
LLM_MODEL=anthropic/claude-sonnet-4
```

OrcaRouter is an OpenAI-compatible LLM provider. ChatCrystal has its `https://api.orcarouter.ai/v1` Base URL built in, so do not set `LLM_BASE_URL` for it. In **Settings**, enter your OrcaRouter API Key, fetch the available models, and select one before saving. [Get an OrcaRouter API Key](https://www.orcarouter.ai/ref/ref_67516d927343232775e2).

## LLM and Embedding Models

LLM and embedding models must be configured separately. Semantic search requires a model that supports the `/v1/embeddings` endpoint.

| Provider | Common embedding models |
|---|---|
| Ollama | `nomic-embed-text`, `mxbai-embed-large` |
| OpenAI | `text-embedding-3-small`, `text-embedding-3-large` |
| Google | `text-embedding-004` |

Large language models such as Claude, GPT, and Qwen are not embedding models.

## Data Directory

Everything is stored under the active data directory (`~/.chatcrystal/data` by default; override with `DATA_DIR`):

| Path | Contents |
|---|---|
| `chatcrystal.db` | SQLite database in WAL mode. While the app runs, `chatcrystal.db-wal` and `chatcrystal.db-shm` belong to it — quit the app or copy all three files together when backing up. |
| `transcript-cache/` | Gzip JSON snapshots of parsed transcripts, keyed by source, conversation, parser version, and file metadata. Safe to delete; conversations are re-parsed from the original agent files when needed. |
| `config.json` | Providers, enabled sources, and app configuration. |
| `vectra-index/` | Local embedding index used by semantic search (created after the first summary). |

The transcript cache is optional acceleration: it keeps later reads, lazy detail loads, and interrupted-sync recovery fast. It is pruned in the background to the size and age caps above and never replaces the original agent session files.

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

### The onboarding window is blank on first install

Packaged builds before 0.7.1 could open a blank setup window because the page could not load its assets from inside the app bundle, and its buttons failed with an origin error. Update to 0.7.1 or newer. Source/dev builds were not affected.

### Conversations stay marked "Indexing"

The sync was cancelled, interrupted, or failed before that transcript finished. Check the sidebar for the last result, then click **Retry** (or **Start sync**). Opening the conversation also materializes it on demand. If one specific file keeps failing, the original agent session file may be malformed or locked by the agent that is still writing it.

### The first sync is slow or uses a lot of CPU

The first pass parses your entire history; later passes only parse new or changed files. You can cancel it and browse the indexed rows, lower `CHATCRYSTAL_PARSE_WORKERS`, or set `CHATCRYSTAL_AUTO_SYNC=0` and sync manually. WSL histories are slower because files are read over `\\wsl.localhost`.

### Disk usage keeps growing

Most of the extra space is the transcript cache. It self-prunes to 512 MB / 30 days by default; lower `CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_MB` or `CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_AGE_DAYS`, or set `CHATCRYSTAL_TRANSCRIPT_CACHE=off` and delete the `transcript-cache` folder while the app is closed. The SQLite database grows with imported messages and notes; delete old conversations from the Conversations page when you no longer need them.

### The knowledge graph is empty

Generate notes first. The default graph is built from note tags, so it appears after summarized notes have tags. If the graph is still empty, check that your notes include tags or lower the graph strength filter.
