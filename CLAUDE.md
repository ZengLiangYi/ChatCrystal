# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChatCrystal is an AI conversation knowledge crystallization tool. It imports conversations from AI coding tools (currently Claude Code), uses LLM to generate structured notes (title, summary, key conclusions, code snippets, tags), and provides semantic search via embeddings. The UI is in Simplified Chinese.

## Commands

```bash
# Development (server port 3721 + client port 13721)
npm run dev

# Build for production
npm run build

# Production server (serves frontend statically on port 3721)
npm start

# System tray (Windows)
npm run tray                # with console
npm run tray:silent         # silent (VBS launcher)

# Lint
npm run lint
npm run lint:fix
```

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
  - `parser/` — Plugin architecture via `SourceAdapter`. Currently: `adapters/claude-code.ts` (JSONL from `~/.claude/projects/`). Content sanitization strips `<system-reminder>`, `<command-name>` tags.
  - `services/llm.ts` — Provider factory: Ollama/OpenAI/Custom via Vercel AI SDK
  - `services/summarize.ts` — Conversation preprocessing (truncate ~8000 tokens) + LLM call + JSON parsing + DB persistence. Auto-generates embeddings after summarization.
  - `services/embedding.ts` — Embedding model factory + vectra LocalIndex + text chunking
  - `services/import.ts` — Scan + dedup (file size + mtime) + batch insert
  - `routes/` — REST endpoints: status, config, import, conversations CRUD, notes CRUD, tags, search, queue status, batch operations
  - `queue/` — p-queue singleton (concurrency=1, 1 req/sec, 429 retry)
  - `watcher/` — chokidar watches `~/.claude/projects/**/*.jsonl`, debounced auto-import

### `client/` — React SPA
- **Build:** Vite v8 + `@vitejs/plugin-react`
- **Styling:** Tailwind CSS v4 via `@tailwindcss/vite`. Custom utility classes in `index.css` reference CSS variables injected by ThemeProvider.
- **State:** TanStack React Query v5; React Context for theming
- **Routing:** React Router v7. Pages: Dashboard, Conversations, ConversationDetail, Notes, NoteDetail, Search, Settings
- **Components:** MarkdownRenderer (react-markdown + remark-gfm + react-syntax-highlighter/Prism), ToolCallGroup (collapsible), Layout, Sidebar
- **Path alias:** `@/` maps to `client/src/`
- **Theming:** Runtime CSS variable injection. Theme: `dark-workshop`

### `scripts/` — System Tray & Launchers
- `tray.ps1` — PowerShell WinForms NotifyIcon tray app. Manages server as hidden child process with auto-restart. Menu: Open Browser, Start/Stop, Auto Start toggle, Exit.
- `start-silent.vbs` — VBS wrapper for hidden launch (no console popup)

## Data Flow

```
~/.claude/projects/**/*.jsonl
  → Claude Code Adapter (parse + sanitize)
  → Import Service (dedup, insert)
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
- `CLAUDE_PROJECTS_DIR` — path to Claude Code projects
- `LLM_PROVIDER` / `LLM_MODEL` — for summarization (ollama, openai, anthropic, google, custom)
- `EMBEDDING_PROVIDER` / `EMBEDDING_MODEL` — for semantic search

## Key Patterns

- **SourceAdapter plugin interface** (`parser/adapter.ts`): implement `detect()`, `scan()`, `parse()` to add new sources
- **Shared types are the contract**: both server and client import from `@chatcrystal/shared`
- **No ORM**: raw SQL via sql.js with parameterized queries
- **sanitizeContent()**: strips Claude Code system XML tags from message content
- **Consecutive tool-use messages**: grouped and collapsed in frontend (ToolCallGroup component)
- **Production SPA fallback**: Fastify serves `client/dist`, non-API 404s return `index.html`
