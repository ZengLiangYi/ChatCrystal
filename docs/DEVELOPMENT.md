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
| LLM | Vercel AI SDK v6 |
| Embeddings | vectra local vector index |
| Queue | p-queue |
| File watching | chokidar |

## Development Commands

```bash
npm run dev                   # Server 3721 + client 13721
npm run build                 # Build server and client
npm start                     # Production server
npm run lint                  # Biome + client ESLint
npm run lint:fix              # Apply safe lint fixes
npm run test -w server        # Server tests
npm run dev:electron          # Electron dev mode
npm run build:electron        # Build Windows installer
npm run pack:electron         # Build unpacked Electron app
npm run eval:experience -w server
```

`npm run eval:experience -w server` runs the offline calibration suite for the experience quality gate.

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

Structured output uses Vercel AI SDK `generateObject()` with Zod schemas. This avoids fragile JSON extraction and lets schema validation retry invalid model output.

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
| GET | `/api/relations/graph` | Knowledge graph data |
| GET | `/api/queue/status` | Queue status |

## Knowledge Graph

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
npm run test -w server
npm run build
npm run lint
npm run eval:experience -w server
```

Use focused server tests while iterating, then run the full commands before committing.

## Release

```bash
npm run release
npm run release -- minor
npm run release -- major
npm run release -- 1.0.0
```

The release script bumps version, creates a git tag, and pushes so CI can build and publish artifacts.

