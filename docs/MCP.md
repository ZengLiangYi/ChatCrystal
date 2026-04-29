# MCP and Agent Integration

English | [简体中文](MCP.zh-CN.md)

This guide explains how ChatCrystal integrates with AI agents through MCP and publishable skills.

## Overview

ChatCrystal has three agent integration layers:

- **ChatCrystal Core**: local storage, search, merge, writeback, and quality filtering.
- **MCP Layer**: stable stdio tools for recall, search, note lookup, relation lookup, and writeback.
- **Skill Layer**: portable skills that teach agents when to recall and when to write back reusable experience.

The Core layer is the trusted boundary. Skills can provide guidance, but MCP/Core must enforce validation because many agents and clients can call the tools directly.

## Start the MCP Server

```bash
crystal mcp
```

ChatCrystal MCP uses stdio transport. Configure it with `command` and `args`, not as an HTTP/SSE MCP URL.

Example agent configuration:

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

If a tool separately asks for an HTTP API endpoint, use `http://localhost:3721`. Do not use a bare `http://127.0.0.1` URL without a port because HTTP defaults to port 80.

## MCP Tools

ChatCrystal exposes six MCP tools:

| Tool | Purpose |
|---|---|
| `search_knowledge` | Semantic search over notes |
| `get_note` | Read a note by id |
| `list_notes` | Browse notes with optional filters |
| `get_relations` | Read related notes and relation metadata |
| `recall_for_task` | Recall project-first memories before substantive work |
| `write_task_memory` | Persist reusable task experience after meaningful work |

## Memory Loop

The intended loop is:

1. Before substantive implementation, debugging, migration, configuration, or optimization work, the agent calls `recall_for_task`.
2. The agent applies relevant prior patterns, pitfalls, and decisions.
3. After meaningful work completes, the agent calls `write_task_memory`.
4. Core validates the candidate, filters low-signal content, and creates or merges a memory.

The loop prioritizes reusable experience over raw conversation storage.

## Full Mode and Degraded Mode

Full mode requires:

- ChatCrystal installed
- local server reachable
- MCP server configured
- stable agent session/run key for auto writeback

If Core or MCP is unavailable:

- recall skills should continue without claiming memory was recalled
- writeback skills should not claim persistence
- auto writeback should emit a structured candidate instead of silently switching to manual persistence

## Agent Skills

Tracked skills live under [`skills/`](../skills). See:

- [Agent Skills](agent-skills.md)
- [Agent Skills 简体中文](agent-skills.zh-CN.md)

The currently published skill set is intentionally narrow:

- `chatcrystal-task-recall`
- `chatcrystal-debug-recall`
- `chatcrystal-task-writeback`

## Quality Gate

MCP writeback is protected by the same experience quality standard used by the summarization pipeline. Low-signal summaries, unverified work, raw logs, and informational exchanges should be filtered before they become memory assets.

See [Experience Quality Gate](EXPERIENCE_GATE.md).

