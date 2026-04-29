---
name: chatcrystal-task-writeback
description: Write reusable ChatCrystal task memories after substantive work completes. Use when implementation or debugging produced a durable fix, pitfall, pattern, or decision worth preserving, and when the environment can either persist it through `write_task_memory` or emit a structured memory candidate for later save.
---

# ChatCrystal Task Writeback

Use this skill after meaningful work completes. Let ChatCrystal Core decide whether a memory should be skipped, merged, or created.

## Workflow

1. Trigger only after substantive work completes and the result produced reusable knowledge.
2. Good candidates include:
   - a durable fix
   - a meaningful pitfall
   - a reusable pattern
   - an explicit engineering decision

## Quality Gate Preflight

Before calling `write_task_memory`, verify the candidate is an experience asset, not a work log.

Do not call `write_task_memory` when:

- The summary only says what changed, without why it mattered.
- There is no clear problem, decision, pitfall, resolution, or reusable pattern.
- The task produced no durable lesson for future work.

Required field shape by `memory.outcome_type`:

- `fix`: include `root_cause` or `resolution`.
- `pitfall`: include `pitfalls` plus `resolution` or `reusable_patterns`.
- `decision`: include `decisions`.
- `pattern`: include `reusable_patterns`.

Write `memory.summary` as a durable experience conclusion, not as "I did X".
Automatic writeback must include `source_run_key`; without it, emit a structured candidate for later save instead of silently writing manual memory.

3. If `write_task_memory` is available and the runtime has a stable run or session key, call it with:
   - `mode: "auto"`
   - `source_run_key`: the stable run or session key
   - `task.goal`, `task.task_kind`, `task.project_dir`, `task.cwd`, `task.branch`
   - `task.source_agent` when known
   - `memory.summary`: concise and durable, not chatty
   - `memory.outcome_type`: one of `pitfall`, `fix`, `pattern`, `decision`
   - `memory.root_cause`, `memory.resolution`, `memory.error_signatures`, `memory.files_touched`, `memory.tags` when relevant
4. Use `mode: "manual"` only for an explicit manual save flow, never as a silent fallback for automatic writeback.
5. Default to project-scoped knowledge. Only use global scope for clearly cross-project knowledge and only in an explicit manual save flow.
6. Report the persistence result accurately:
   - `created`
   - `merged`
   - `skipped`

## Example MCP Input

Use this shape when calling `write_task_memory` after a completed task with a stable run key:

```json
{
  "mode": "auto",
  "source_run_key": "agent-session-or-run-id",
  "scope": "project",
  "task": {
    "goal": "Fix MCP recall schema validation",
    "task_kind": "debug",
    "project_dir": "/path/to/project",
    "cwd": "/path/to/project",
    "branch": "fix/mcp-recall-schema",
    "files_touched": [
      "server/src/services/memory/schemas.ts",
      "server/src/cli/mcp/server.ts"
    ],
    "error_signatures": [
      "invalid_type",
      "recall_for_task schema mismatch"
    ],
    "source_agent": "codex"
  },
  "memory": {
    "summary": "MCP tool schemas must stay aligned with memory service request shapes; mismatches surface as validation failures before tool execution.",
    "outcome_type": "fix",
    "root_cause": "The MCP tool input shape diverged from the service schema.",
    "resolution": "Reused the shared request shape in the MCP server registration.",
    "files_touched": [
      "server/src/services/memory/schemas.ts",
      "server/src/cli/mcp/server.ts"
    ],
    "tags": [
      "mcp",
      "memory-loop",
      "schema"
    ]
  }
}
```

## Full Mode

Full mode requires ChatCrystal Core plus MCP access to `write_task_memory`.

- Do not reimplement skip or merge logic in the skill.
- Trust Core to decide whether the memory should be skipped, merged, or created.
- If the tool reports `skipped`, keep the task result but do not force persistence.

## Degraded Mode

If ChatCrystal Core or the MCP tool is unavailable, or if no stable run key exists for automatic writeback:

- Do not claim that the memory was saved.
- Emit a structured memory candidate in the response for later save.
- Keep the candidate aligned with the `write_task_memory.memory` payload shape so it can be reused later.
- Do not instruct the runtime to auto-install ChatCrystal Core as part of the skill flow.
