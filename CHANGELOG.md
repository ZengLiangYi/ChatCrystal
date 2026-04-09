# Changelog

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
