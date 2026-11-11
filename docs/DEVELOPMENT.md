# ChatCrystal Development Guide

English | [简体中文](DEVELOPMENT.zh-CN.md)

This guide covers repository structure, architecture, development commands, testing, and release workflows.

## Project Overview

ChatCrystal is a local-first AI conversation crystallization tool. It imports conversations from AI coding tools, generates structured notes with LLMs, builds embeddings for semantic search, and exposes both UI and MCP workflows.

## Monorepo Layout

```
ChatCrystal/
├── shared/                  # Shared TypeScript types
├── server/                  # Fastify backend, CLI, MCP server
├── client/                  # React SPA
├── electron/                # Electron main and preload processes
├── skills/                  # Publishable ChatCrystal agent skills
├── docs/                    # Maintainer and user documentation
├── scripts/                 # Release and utility scripts
└── site/                    # Project website
```

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Fastify v5, TypeScript |
| Frontend | Vite v8, React 19, Tailwind CSS v4, TanStack React Query v5 |
| Desktop | Electron, electron-builder |
| Database | `node:sqlite` (built-in SQLite, WAL); parser-side SQLite readers use sql.js |
| LLM | Vercel AI SDK v7 |
| Embeddings | vectra local vector index |
| Queue | p-queue |
| File watching | chokidar |

## Development Commands

```bash
corepack enable
pnpm install
pnpm dev                              # Server 3721 + client 13721
pnpm build                            # Build server and client
pnpm start                            # Production server
pnpm lint                             # Biome + client ESLint
pnpm lint:fix                         # Apply safe lint fixes
pnpm test                             # All tests, including dependency audit policy
pnpm test:server                      # Server tests only
pnpm test:client                      # Client tests only
pnpm test:electron                    # Electron tests only
pnpm dev:electron                     # Electron dev mode
pnpm build:electron                   # Build Windows installer
pnpm pack:electron                    # Build unpacked Electron app
pnpm --filter ./server smoke:mcp      # End-to-end MCP smoke (run after build)
pnpm --filter ./server eval:experience
pnpm security:audit                   # Fail on high/critical findings
pnpm security:signatures              # Verify registry signatures
```

The root workspace requires Node.js 24 and pnpm 11 through Corepack. `site/` and `promo/` remain independent npm projects. `pnpm --filter ./server eval:experience` runs the offline calibration suite for the experience quality gate.

### Dependency policy

- `pnpm-lock.yaml` is the only lockfile for the root, server, client, shared, and Electron build graph.
- Keep pnpm's isolated, project-local virtual store layout: electron-builder uses its versioned paths to package the correct production dependency when multiple versions are installed.
- New package releases are held for 24 hours by default. Exact exceptions are reserved for time-sensitive security fixes and must include an inline rationale.
- Registry trust downgrades are rejected for recently published packages, exotic subdependencies are blocked, and dependency lifecycle scripts use an explicit allowlist.
- `pnpm security:audit` prints the complete audit report and fails on high or critical findings. `pnpm security:signatures` verifies registry signatures.
- Dependabot checks workspace packages and GitHub Actions weekly. Minor and patch updates are grouped; major updates remain separate for review.

## Runtime Data

Runtime data is stored in `config.json` and `chatcrystal.db` under the active data directory.

Default data directory:

- CLI, MCP, npm package, repository checkout, and Electron: `~/.chatcrystal/data`
- Explicit override: `DATA_DIR`

Electron sets `ELECTRON=true`, `DATA_DIR`, and `ELECTRON_PACKAGED` when applicable.

## Data Flow

```
AI tool conversation files
  -> SourceAdapter detect/scan (metadata only, no file contents)
  -> Background sync engine (startup pass + targeted watcher; one pass at a time)
  -> SourceAdapter parse in the worker-thread pool
  -> Import service deduplication
  -> SQLite (node:sqlite, WAL) conversations/messages
  -> Summarization queue
  -> LLM structured note generation
  -> Embedding generation
  -> vectra semantic index
  -> REST API, UI, CLI, MCP
```

## Background Sync & Parsing

- `services/sync.ts` is the only importer: a small state machine (`idle`, `syncing`, `cancelled`, `error`) with per-source progress and pending-trigger merging. `createServer` schedules one pass 2.5s after boot; the watcher feeds targeted source lists. The client polls `GET /api/sync/status`; `POST /api/sync/start` and `POST /api/sync/cancel` drive it manually, and `GET /api/sync/stream` is the SSE variant.
- The watcher starts only after the first startup pass settles. chokidar's initial scan over a large history (a workbuddy home can hold ~70k plugin files) otherwise competes with the import's filesystem reads. Events are mapped to the owning source by longest-prefix target binding and debounced for 1.8s.
- `importAll()` takes `{ sources?, signal?, onProgress?, parsePool? }` and emits phase/per-source progress plus error details. It is still callable as `importAll(callback)` for the legacy CLI/SSE route.
- **Index-first**: the collection phase writes a `conversations` row for every scanned file (`transcript_status = 'pending'`) before parsing starts, so the conversation list fills in right after a scan. The import loop materializes each transcript and flips the row to `'materialized'`; a cancelled or interrupted pass leaves pending rows that the detail route and summarizer materialize on demand (`materializeConversationById`).
- **Transcript cache**: parsed conversations are stored under `<dataDir>/transcript-cache/<source>/<sha1>.json.gz`, keyed by source/id/parser version/file path/size/mtime/rootDir. Both the import loop and lazy materialization read it first, so re-reading a session after a DB reset or interrupt skips parsing; size/age caps prune it in the background.
- Parsing defaults to the shared `services/parse-pool.ts` worker pool (`CHATCRYSTAL_PARSE_WORKERS`, default `min(4, cpus-1)`; `0` or `CHATCRYSTAL_PARSE_POOL=off` parses in-process). Tests parse inline because they register fake adapters in-process (`NODE_TEST_CONTEXT`).
- `CHATCRYSTAL_AUTO_SYNC=0` disables the startup/watcher passes; manual sync and `crystal import` still work.

## Summarization Pipeline

ChatCrystal uses turn-based transcript preparation before summarization:

1. Split messages into user-assistant turns.
2. Keep the user instruction plus the first and last substantial assistant replies in each turn.
3. Score turns by instruction length and assistant engagement.
4. Always include the first turn and final turns.
5. Fill the remaining budget with high-value middle turns.
6. Compress skipped turns into one-line previews.

Structured output uses Vercel AI SDK `generateText()` with `Output.object()` and Zod schemas. This avoids fragile JSON extraction and lets schema validation retry invalid model output.

## Source Adapters

Add a new source by implementing `SourceAdapter`:

```typescript
interface SourceAdapter {
  name: string;
  displayName: string;
  parserVersion?: string;
  detect(): Promise<SourceInfo | null>;
  scan(): Promise<ConversationMeta[]>;
  parse(meta: ConversationMeta): Promise<ParsedConversation>;
  /** Optional chokidar targets for live auto-import. */
  watchPaths?(): string[];
}
```

Built-in adapters:

| Adapter | Data Source | Format |
|---|---|---|
| `claude-code` | `~/.claude/projects/**/*.jsonl` | JSONL conversation log |
| `codex` | `~/.codex/sessions/**/rollout-*.jsonl[.zst]` + `archived_sessions/` | JSONL event stream (old `event_msg` and 0.160+ `item_completed` formats, multi-frame zstd) |
| `cursor` | Cursor `workspaceStorage/state.vscdb` | SQLite KV store |
| `trae` | Trae `workspaceStorage/state.vscdb` | SQLite KV store |
| `copilot` | VS Code `workspaceStorage/chatSessions/*.jsonl` | JSONL snapshots |
| `gemini` | `~/.gemini/tmp/*/chats/session-*.{json,jsonl}` | Session JSON / replay JSONL |
| `qwen` | `~/.qwen/projects/*/chats/*.jsonl` | Claude-style JSONL |
| `opencode` | `~/.local/share/opencode/opencode.db` (or `storage/**/*.json`) | SQLite / JSON documents |
| `cline` | `~/.cline/data/sessions/*/*.messages.json`, VS Code extension `tasks/*` | Whole-file JSON |
| `roo` | `<VS Code User>/globalStorage/rooveterinaryinc.roo-cline/tasks/*` | Whole-file JSON |
| `kilo` | `<VS Code User>/globalStorage/kilocode.kilo-code/tasks/*` | Whole-file JSON |
| `copilot-cli` | `~/.copilot/session-state/*/events.jsonl` | Event JSONL |
| `continue` | `~/.continue/sessions/*.json` | Whole-file JSON |
| `dsh` | `~/.dsh/sessions/**/session.v<N>.jsonl[.zstd]` | JSONL (multi-frame zstd) |
| `workbuddy` | `~/.workbuddy(-ai)/projects/*/*.jsonl` | JSONL (OpenAI Agents items) |
| `antigravity` | `~/.gemini/antigravity/brain/*/.system_generated/logs/transcript.jsonl` | Step JSONL |
| `droid` | `~/.factory/sessions/**/*.jsonl` | Event JSONL |
| `goose` | `~/.local/share/goose/sessions/sessions.db` (or `*.jsonl`) | SQLite / JSONL |
| `pi` | `~/.pi/agent/sessions/*/*.jsonl` | JSONL entries (session header + messages) |
| `omp` | `~/.omp/agent/sessions/*` + profiles | Pi-format JSONL |
| `raft` | `~/.slock/agents/*/.pi-sessions|.builtin-sessions/*.jsonl` | Pi-format JSONL |
| `cindy` | `<config>/Cindy*/pi-agent-home/sessions/*.jsonl` | Pi-format JSONL |
| `qoder` / `qoder-cn` | `~/.qoder(-cn)/projects/*/*.jsonl` | Claude-style JSONL |
| `codebuddy` | `~/.codebuddy/projects/*/*.jsonl` | JSONL (OpenAI Agents items, same as WorkBuddy) |
| `claude-desktop` | `<Claude data>/local-agent-mode-sessions/*/*/local_*/.claude/projects/*` | Claude-style JSONL |
| `zcode` | `~/.zcode/cli/db/db.sqlite` | OpenCode schema (SQLite) |
| `hermes` | `~/.hermes/state.db` | SQLite sessions/messages |
| `alma` | `<config>/alma/chat_threads.db` | SQLite threads/messages |
| `grok` | `~/.grok/sessions/<cwd>/<id>/updates.jsonl` | ACP update JSONL + summary.json |
| `kimi` | `~/.kimi-code/sessions/*/*/agents/main/wire.jsonl` | Wire JSONL + state.json |
| `minimax-code` | `~/.minimax/v2/sessions/**/messages*.jsonl` | JSONL messages |

Create the adapter under `server/src/parser/adapters/`, register it in `server/src/parser/index.ts`, and add its id to `ALL_SOURCE_NAMES` in `server/src/config.ts` (that list also drives `enabledSources` migration and remote import validation).

### WSL roots on Windows

File-based adapters can also read the same agent installed inside a WSL distro. `parser/wsl.ts` discovers the homes of running distros (`\\wsl.localhost\<distro>\home\<user>`), and `parser/sourceRoots.ts` exposes `withWslRoots(primaryDir, '<relative path>')` / `wslRootsFor('<relative path>')`:

```typescript
const roots = withWslRoots(appConfig.codexSessionsDir, '.codex/sessions');
for (const root of roots) {
  // scan root
}
```

- `withWslRoots` always returns the primary root first; WSL roots are added only when `<distro home>/<relative path>` exists.
- `scan()` should set `rootDir: root` on every `ConversationMeta`; `parse()` uses `meta.rootDir ?? appConfig.<primary>` when it needs root-level metadata (Gemini `projects.json`, Antigravity summary DB, Continue `sessions.json`, Cline extension `taskHistory.json`, ...).
- `watchPaths()` should only return local roots: the watcher never watches UNC paths (slow, and it can start a stopped distro).
- Point `watchPaths()` at the narrowest session folder, not the agent home. chokidar has to scan a target before it can watch it; a broad target (for example `~/.workbuddy` with its plugin marketplaces) starves the first import's filesystem reads.
- Discovery honors `CHATCRYSTAL_WSL=0` (disable), `CHATCRYSTAL_WSL_DISTROS` (opt specific distros in, they may start on access), and `CHATCRYSTAL_WSL_HOMES` (forced homes). Tests inject fixture homes with `setWslHomesForTesting([...])`.

## API Surface

Key REST endpoints:

| Method | Path | Description |
|---|---|---|
| GET | `/api/status` | Server status and statistics |
| GET | `/api/config` | Current config with secrets redacted |
| POST | `/api/config` | Update provider config |
| POST | `/api/import/scan` | Trigger import |
| GET | `/api/conversations` | List conversations |
| GET | `/api/conversations/:id` | Conversation detail |
| POST | `/api/conversations/:id/summarize` | Summarize one conversation |
| POST | `/api/summarize/batch` | Batch summarization |
| GET | `/api/notes` | List notes |
| GET | `/api/notes/:id` | Note detail |
| GET | `/api/search?q=...&expand=true` | Semantic search |
| GET | `/api/graph/projection` | Bounded graph projection for the UI |
| GET | `/api/relations/graph` | Legacy note relation graph data |
| GET | `/api/queue/status` | Queue status |

## Knowledge Graph

The default graph UI uses `/api/graph/projection?level=tag`. It renders tags as knowledge-point nodes and connects tags that co-occur in the same note. Tag edge strength is normalized as `cooccurrence_count / sqrt(tagA_note_count * tagB_note_count)`, then filtered and capped before it reaches the client.

The note relation graph remains available through `/api/relations/graph` and `/api/graph/projection?level=note` for compatibility and relation-aware workflows.

The relation system supports these relation types:

| Relation | Meaning |
|---|---|
| `CAUSED_BY` | Causation |
| `LEADS_TO` | Leads to |
| `RESOLVED_BY` | Resolved by |
| `SIMILAR_TO` | Similar topic |
| `CONTRADICTS` | Contradiction |
| `DEPENDS_ON` | Dependency |
| `EXTENDS` | Extension |
| `REFERENCES` | Reference |

Relations can be discovered by LLM, added manually, or followed during semantic search expansion.

## Testing

Primary verification:

```bash
pnpm test
pnpm build
pnpm --filter ./server smoke:mcp
pnpm lint
pnpm --filter ./server eval:experience
pnpm security:audit
pnpm security:signatures
```

Use a focused layer while iterating, then run the full commands before committing. The MCP smoke test uses compiled output, so run `pnpm build` first.

## Release

```bash
pnpm release                    # Full release: npm + Electron, tag v*
pnpm release -- minor
pnpm release -- major
pnpm release -- 1.0.0
pnpm release:electron -- 1.0.1  # Electron-only release, tag electron-v*
pnpm release:npm -- 1.0.1       # npm-only release, tag npm-v*
```

Use `scripts/release.mjs` for releases. Avoid manually bumping versions, committing, tagging, and pushing unless you are doing an explicit recovery flow.

Release tag behavior:

- `v*` tags trigger both npm publishing and Electron GitHub Release builds. Use this only when both root `package.json` and `server/package.json` should move together.
- `electron-v*` tags trigger Electron-only GitHub Release builds. Use this for desktop-only changes, including Electron main/preload/tray/packaging changes and Electron-gated client UI.
- `npm-v*` tags publish only the npm package. Use this for CLI, server, MCP, or package-content changes.
- The npm package version comes from `server/package.json`, not the root package. A `v*` release will fail with npm `E403` if `server/package.json` still points to an already-published version.
