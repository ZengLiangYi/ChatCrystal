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
| Database | sql.js WASM SQLite |
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
pnpm test                             # Server tests
pnpm dev:electron                     # Electron dev mode
pnpm build:electron                   # Build Windows installer
pnpm pack:electron                    # Build unpacked Electron app
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
  -> SourceAdapter scan/parse
  -> Import service deduplication
  -> SQLite conversations/messages
  -> Summarization queue
  -> LLM structured note generation
  -> Embedding generation
  -> vectra semantic index
  -> REST API, UI, CLI, MCP
```

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
| `copilot` | VS Code `workspaceStorage/chatSessions/*.jsonl` | JSONL snapshots |

Create the adapter under `server/src/parser/adapters/` and register it in `server/src/parser/index.ts`.

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
pnpm lint
pnpm --filter ./server eval:experience
pnpm security:audit
pnpm security:signatures
```

Use focused server tests while iterating, then run the full commands before committing.

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
