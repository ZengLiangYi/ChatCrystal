# Changelog

## [0.4.9] - 2026-04-29

### Experience Quality Gate

- **Hybrid experience filtering** — Added lexical signal extraction, deterministic prefilters, and an LLM-scored rubric to keep reusable problem-solving experience while rejecting low-signal transcripts before note creation.
- **Reviewable filter metadata** — Conversations can now persist `experience_score`, `experience_gate_reason`, and `experience_gate_details`; rejected summaries are marked `filtered` instead of creating notes.
- **Writeback quality validation** — `write_task_memory` now rejects sparse structured memories in automatic mode and records idempotent receipts with low-signal reasons.

### Calibration

- **Offline gate evaluation** — Added `npm run eval:experience -w server` with 37 synthetic calibration samples, false accept/reject reporting, and sample provenance/privacy checks.

### Documentation

- **Bilingual docs split** — Slimmed the root READMEs and moved user guide, MCP, development, experience gate, and agent skills content into paired English and Simplified Chinese docs.

## [0.4.8] - 2026-04-28

### npm Package

- **npm-only patch release** — Bumped the published `chatcrystal` server/CLI package to `0.4.8` without changing the Electron/root package version.
- **Cross-platform runtime path tests** — Reworked runtime path tests to run against Windows and POSIX path resolvers so CI does not depend on the runner OS.

## [0.4.7] - 2026-04-28

### Runtime & CLI

- **Unified data directory** — CLI, MCP, development checkouts, global npm installs, and Electron now share `~/.chatcrystal/data` by default, with `DATA_DIR` as the explicit override.
- **More reliable `crystal serve stop`** — Daemon shutdown now validates PID ownership, cleans stale PID files, and falls back to the listening port when needed.
- **Local base URL normalization** — CLI and MCP clients normalize local URLs, add the default `3721` port for localhost HTTP URLs, and reject unsupported protocols with clearer errors.

### Skills & MCP

- **Publishable ChatCrystal skills** — Added packaged task recall, task writeback, and debug recall skills with OpenAI agent manifests and install/use documentation.
- **Memory-loop docs** — Expanded README and skill docs with MCP configuration, recall/writeback examples, and architecture notes for the task memory loop.

### Quality & Tooling

- **Biome linting** — Added a repository Biome config and wired root `npm run lint` / `lint:fix` through Biome plus the client ESLint pass.
- **Release quality gates** — Release workflows now run lint and server tests before building npm and Electron artifacts.
- **Dependency refresh** — Updated core client, server, site, promo, Electron, and build tooling dependencies; split theme context/hooks to satisfy React refresh linting.

## [0.4.6] - 2026-04-16

### Memory Loop

- **Task memory recall + writeback APIs** — Added `/api/memory/recall` and `/api/memory/writeback` with shared request/response contracts for project-first recall, global supplement recall, and agent/manual memory writeback.
- **MCP memory tools** — Added `recall_for_task` and `write_task_memory` to the MCP server so external agents can retrieve and persist task memories through the same server-side contract.
- **Conservative writeback semantics** — Automatic writeback now supports idempotent receipts, pending/completed indexing status, conservative merge decisions, and supplemental relations for strongly related memories.

### Memory Metadata

- **Project-scoped memory model** — Notes now store `project_key`, `scope`, `source_type`, `source_agent`, `task_kind`, `error_signatures`, `files_touched`, and `outcome_type`, with DB bootstrap/backfill for legacy imported notes.
- **Synthetic memory origins** — Added synthetic origin conversations for writeback-created memories while hiding them from the default conversations list.
- **Project identity stability** — Added canonical project-key derivation plus alias support so moved repos and upgraded project identifiers can still recall the same project memories.

### Quality

- **Coverage for memory services and routes** — Added regression tests across schemas, project-key derivation, recall, writeback, backfill, origin creation, decision logic, and HTTP route behavior.
- **Real HTTP + MCP smoke coverage** — Verified the full writeback/recall loop through a real Fastify process and MCP stdio server with a mock embedding backend.

### Client Performance

- **Route-level lazy loading** — Switched the main client routes to lazy-loaded page bundles with a shared suspense fallback so the initial app payload is smaller.
- **Relation graph canvas split** — Moved the force-graph implementation into a lazily loaded `RelationGraphCanvas` component so the graph runtime is only loaded when the graph page is opened.
- **Lighter markdown code blocks** — Replaced `react-syntax-highlighter` with native `<pre><code>` rendering and removed the related client dependencies from the bundle.

## [0.4.0] - 2026-04-10

### New Data Sources

- **Trae adapter** — Imports conversations from Trae IDE. Reads `memento/icube-ai-agent-storage` from workspace `state.vscdb`. Extracts assistant responses from `agentTaskContent.guideline.planItems`, reasoning content as thinking, and handles unreliable timestamps via `turnIndex` ordering.
- **GitHub Copilot adapter** — Imports conversations from VS Code's GitHub Copilot Chat. Supports both `.jsonl` (session snapshots) and `.json` (older format) from `workspaceStorage/chatSessions/` and `globalStorage/emptyWindowChatSessions/`. Extracts thinking blocks, tool invocations, and `customTitle` as slug.

### Improvements

- **Shared sql.js module** — Extracted `openVscdb()` into `parser/vscdb.ts`, shared by Cursor and Trae adapters. Single sql.js instance across the process.
- **Cursor orphan bubble discovery** — Scans `cursorDiskKV` for composers with bubble data not listed in any workspace's `composerData`. Filters out empty shells (no text content) to avoid noise.
- **Codex scan 65x faster** — Replaced serial `readFirstLine()` (97ms/file) with filename-based sessionId extraction + parallel `stat()` in batches of 20. Scan time: 40s → 0.6s for 337 files.
- **Scan caching** — All adapters with expensive detect→scan cycles (Cursor, Codex, Copilot) now use 5-second TTL caches to avoid redundant filesystem traversal.
- **Config migration** — Existing `config.json` files automatically gain new `trae` and `copilot` entries in `enabledSources` on upgrade.
- **Frontend source badges** — Added Trae (indigo) and Copilot (GitHub blue) to `SOURCE_CONFIG` and `SOURCE_COLORS` maps.
- **Platform path robustness** — All adapters now use `homedir()` from `node:os` instead of `process.env.HOME` for macOS/Linux paths.

## [0.3.0] - 2026-04-09

### Core: Turn-Based Transcript Engine

- **Turn-based selection algorithm** — Replaced naive head+tail truncation with an intelligent turn-based approach. Messages are grouped into turns (user instruction + assistant response), scored by `user_text_length × (1 + assistant_reply_count)`, and selected within a character budget. Skipped turns are compressed to one-line summaries preserving the causal chain.
- **New module: `transcript.ts`** — Extracted transcript preparation into a dedicated module with clean separation from the summarization orchestration in `summarize.ts` (net -67 lines from summarize.ts).
- **Configurable token budget** — Added `LLM_MAX_INPUT_CHARS` env var and `llm.maxInputChars` config (default 32,000). Users with large-context models can increase for better summarization quality.
- **Noise filtering** — Tool call chains within turns are stripped. Short confirmation turns (< 20 chars) are collapsed. Only first and last substantial assistant replies are kept per turn.

### Core: Relations Structured Output

- **Relations migrated to `generateObject`** — Replaced `generateText` + fragile `extractJSONArray` with `generateObject({ output: 'array' })` + Zod element schema. Same reliability upgrade as the v0.2.9 summarization migration.
- **Deleted legacy parser** — Removed `extractJSONArray()` and `VALID_RELATION_TYPES` array (validation now handled by Zod enum). Net -36 lines.

### Core: Embedding Status Tracking

- **`embedding_status` column** — New column on `notes` table (`pending` / `done` / `failed`) with automatic migration for existing databases.
- **Failure visibility** — Embedding failures are now persisted as `failed` status instead of silently swallowed. Notes that failed embedding are visible to users and automatically picked up by batch rebuild.
- **Batch rebuild covers failures** — `POST /api/embeddings/batch` now queries `embedding_status IN ('pending', 'failed')` instead of checking the embeddings table.

### Documentation

- **README: "How Summarization Works" section** — Technical explanation of the turn-based algorithm and structured output approach, in both English and Chinese READMEs.

## [0.2.9] - 2026-04-09

### Core: Summarization Engine Overhaul

- **Structured output with Zod schema** — Replaced fragile `generateText()` + manual JSON parsing with `generateObject()` + Zod schema validation. LLM output is now guaranteed to match the expected structure, eliminating truncation and parse failures.
- **Built-in retry on schema violation** — `generateObject()` with `maxRetries: 3` automatically feeds validation errors back to the model for self-correction, replacing the previous no-retry-on-parse-failure behavior.
- **Output token limit** — Added `maxOutputTokens: 4096` to prevent mid-JSON truncation caused by low default token limits on some providers/models.
- **System prompt rewrite** — New prompt guides the model to produce structured summaries covering decision context, implementation details, and reusable knowledge. Removed redundant JSON format instructions (now handled by schema).
- **Language-following summaries** — Summaries now match the conversation's language (Chinese conversations get Chinese summaries, English get English) instead of being hardcoded to Chinese.
- **Truncation-aware** — Prompt explicitly instructs the model to summarize based on visible content only when conversations are truncated, rather than guessing omitted parts.
- **Deleted legacy code** — Removed `extractJSON()` and `validateResult()` functions (~50 lines of brittle parsing logic).

### Core: Search Quality Improvements

- **Search result text preview** — `semanticSearch()` now returns actual `chunkText` from the embeddings table instead of hardcoded empty strings, enabling meaningful result previews.
- **Richer embeddings** — Embedding text now includes tags and code snippet descriptions in addition to title, summary, and conclusions, improving keyword matching and semantic relevance.
- **Cleaned up dynamic imports** — Replaced redundant dynamic `import()` calls in the search expand-relations path with top-level imports.

### Dependencies

- Added `zod` as a direct dependency (previously only a transitive dependency via `ai` SDK).

### Landing Page & Site

- Full landing page with Astro 6 + React islands + Tailwind CSS v4 + Framer Motion.
- Bilingual i18n (EN `/`, ZH `/zh/`).
- 7 sections: Hero, IntegrationStrip, HowItWorks, FeatureBento, LocalFirst, CliShowcase, Footer.
- GitHub Pages deployment via GitHub Actions.
- Replaced all emoji icons with proper SVG brand icons (Anthropic, Cursor, OpenAI from SimpleIcons).
- Design audit and full redesign pass.

### Promo Animations (Remotion)

- 5 new landing page compositions: hero, feature-search, feature-mcp, feature-cli, cli-showcase.
- macOS window style (Variant B), 800x450 @ 30fps.
- TransitionSeries for CLI segment transitions.
- Batch render script (`promo/render-landing.sh`).

### CI/CD

- Upgraded all GitHub Actions to Node 24 compatible versions.
- Reverted `setup-node` to v4 (v5 does not exist).

### Docs

- Added website badge to README.

## [0.2.8] - 2026-04-08

- Interactive TUI for CLI (`crystal` commands with Ink 7).
- Codex CLI and Cursor data source adapters.
- File watcher for auto-import from all three data sources.

## [0.2.7] - 2026-04-08

- Electron desktop app with system tray, single-instance lock, window state persistence.
- CSP security policy, graceful shutdown, sandbox mode.
- NSIS installer packaging.
