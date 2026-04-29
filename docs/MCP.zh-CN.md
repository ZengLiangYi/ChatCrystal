# MCP 与 Agent 集成

[English](MCP.md) | 简体中文

本文档说明 ChatCrystal 如何通过 MCP 和可发布 skills 与 AI Agent 集成。

## 概览

ChatCrystal 的 Agent 集成分为三层：

- **ChatCrystal Core**：本地存储、搜索、合并、写回和质量过滤。
- **MCP Layer**：通过 stdio 暴露稳定工具，包括 recall、search、note lookup、relation lookup 和 writeback。
- **Skill Layer**：可移植 skills，指导 Agent 在合适时机召回经验并写回可复用成果。

Core 层是可信边界。Skill 可以提供指导，但 MCP/Core 必须执行校验，因为很多 Agent 和客户端都可能直接调用工具。

## 启动 MCP Server

```bash
crystal mcp
```

ChatCrystal MCP 使用 stdio transport。请用 `command` 和 `args` 配置，不要配置成 HTTP/SSE MCP URL。

Agent 配置示例：

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

如果某个工具另外要求填写 HTTP API endpoint，请使用 `http://localhost:3721`。不要填写没有端口的裸 `http://127.0.0.1`，因为 HTTP 会默认落到 80 端口。

## MCP 工具

ChatCrystal 暴露六个 MCP 工具：

| Tool | 用途 |
|---|---|
| `search_knowledge` | 对笔记进行语义搜索 |
| `get_note` | 按 id 读取笔记 |
| `list_notes` | 浏览笔记，可带过滤条件 |
| `get_relations` | 读取关联笔记和关系元数据 |
| `recall_for_task` | 在实质任务前召回项目优先的经验 |
| `write_task_memory` | 在有结果的任务后持久化可复用经验 |

## Memory Loop

目标流程：

1. 在实质性的实现、调试、迁移、配置或优化任务前，Agent 调用 `recall_for_task`。
2. Agent 应用相关的历史模式、坑点和决策。
3. 有意义的工作完成后，Agent 调用 `write_task_memory`。
4. Core 校验候选内容，过滤低信号内容，并创建或合并记忆。

这个循环优先沉淀可复用经验，而不是保存原始对话。

## Full Mode 与 Degraded Mode

Full mode 需要：

- 已安装 ChatCrystal
- 本地服务可访问
- 已配置 MCP server
- 自动写回具备稳定的 agent session/run key

如果 Core 或 MCP 不可用：

- recall skill 应继续任务，但不能声称已经召回记忆
- writeback skill 不能声称已经持久化
- auto writeback 应输出结构化候选，而不是静默切换为 manual persistence

## Agent Skills

受版本管理的 skills 位于 [`skills/`](../skills)。详见：

- [Agent Skills](agent-skills.md)
- [Agent Skills 简体中文](agent-skills.zh-CN.md)

当前发布的 skill set 有意保持窄范围：

- `chatcrystal-task-recall`
- `chatcrystal-debug-recall`
- `chatcrystal-task-writeback`

## 质量门槛

MCP writeback 受同一套经验质量标准保护。低信号摘要、未验证工作、原始日志和信息型问答不应进入经验资产库。

详见[经验质量门槛](EXPERIENCE_GATE.zh-CN.md)。

