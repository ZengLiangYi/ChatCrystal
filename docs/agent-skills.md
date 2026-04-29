# ChatCrystal Agent Skills

English | [简体中文](agent-skills.zh-CN.md)

ChatCrystal now ships three tracked, publishable agent skills under [`skills/`](../skills):

- `chatcrystal-task-recall`
- `chatcrystal-debug-recall`
- `chatcrystal-task-writeback`

Each skill folder is self-contained and intended to be publishable as a standalone skill asset.

## Why Three Skills

The split matches the current production interfaces in ChatCrystal Core:

- `recall_for_task` for general task recall
- `recall_for_task` in debug mode for failure-oriented recall
- `write_task_memory` for post-task memory writeback

This keeps each skill narrow, triggerable, and store-friendly. We intentionally do not ship a fourth umbrella skill because it would duplicate behavior and drift from the three focused workflows.

## Install from This Repository

The open skills ecosystem installs skills from Git repositories and can target an individual skill in a repository.

Examples:

```bash
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-task-recall
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-debug-recall
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-task-writeback
```

Install all three from this repository by running the three explicit commands:

```bash
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-task-recall
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-debug-recall
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-task-writeback
```

## Full Mode with ChatCrystal Core

The skills are useful on their own, but full memory-loop behavior requires ChatCrystal Core plus MCP.

Manual setup path:

1. Install ChatCrystal Core:

```bash
npm install -g chatcrystal
```

2. Start the local ChatCrystal server:

```bash
crystal serve -d
```

3. Configure your agent to expose the ChatCrystal MCP server:

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

ChatCrystal MCP uses stdio transport. Agent clients should launch it with `command` and `args`, not register it as an HTTP/SSE MCP URL. If a tool separately asks for the ChatCrystal HTTP API endpoint, use `http://localhost:3721` rather than bare `http://127.0.0.1`.

With full mode enabled, ChatCrystal MCP exposes:

- `search_knowledge`
- `get_note`
- `list_notes`
- `get_relations`
- `recall_for_task`
- `write_task_memory`

## Degraded Mode

If ChatCrystal Core or MCP is unavailable:

- recall skills continue without blocking and must not claim any memory was recalled
- writeback must not claim persistence unless `write_task_memory` actually succeeds
- auto writeback requires a stable run key; without one, the skill should emit a memory candidate instead of silently switching to manual persistence

The skills do not auto-run ChatCrystal installation commands as part of their workflow.

## Publishing Guidance

The current recommended source of truth is this repository. A separate `chatcrystal-skills` repository is not required for initial release because the skills ecosystem can install named skills from a multi-skill GitHub repository.

Publishing guidelines for this repository:

- keep each publishable skill in a tracked subdirectory under `skills/`
- keep each skill self-contained with `SKILL.md` and optional `agents/` metadata
- avoid depending on ignored local-only directories such as `.agents/` or `docs/superpowers/`
- keep the tracked docs in this repository aligned with the actual MCP surface

Re-evaluate a dedicated skills repository later if the skill release cadence, contribution model, or branding diverges materially from ChatCrystal Core.
