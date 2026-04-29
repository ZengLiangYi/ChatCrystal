# ChatCrystal Agent Skills

[English](agent-skills.md) | 简体中文

ChatCrystal 现在在 [`skills/`](../skills) 下维护三个可追踪、可发布的 agent skills：

- `chatcrystal-task-recall`
- `chatcrystal-debug-recall`
- `chatcrystal-task-writeback`

每个 skill 目录都是自包含的，目标是可以作为独立 skill asset 发布。

## 为什么是三个 Skills

这个拆分对应 ChatCrystal Core 当前的生产接口：

- `recall_for_task`：通用任务召回
- debug mode 下的 `recall_for_task`：面向故障排查的召回
- `write_task_memory`：任务完成后的经验写回

这样能让每个 skill 保持窄范围、易触发、适合上架。我们有意不发布第四个 umbrella skill，因为它会重复已有行为，并且容易与三个聚焦工作流漂移。

## 从本仓库安装

开放 skills 生态支持从 Git 仓库安装 skill，也可以指定仓库里的单个 skill。

示例：

```bash
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-task-recall
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-debug-recall
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-task-writeback
```

安装本仓库中的全部三个 skills：

```bash
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-task-recall
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-debug-recall
npx skills add https://github.com/ZengLiangYi/ChatCrystal --skill chatcrystal-task-writeback
```

## Full Mode with ChatCrystal Core

Skills 单独也有价值，但完整 memory loop 需要 ChatCrystal Core 和 MCP。

手动配置路径：

1. 安装 ChatCrystal Core：

```bash
npm install -g chatcrystal
```

2. 启动本地 ChatCrystal server：

```bash
crystal serve -d
```

3. 配置你的 Agent 暴露 ChatCrystal MCP server：

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

ChatCrystal MCP 使用 stdio transport。Agent client 应通过 `command` 和 `args` 启动它，不要注册成 HTTP/SSE MCP URL。如果某个工具单独要求 ChatCrystal HTTP API endpoint，请使用 `http://localhost:3721`，不要使用裸 `http://127.0.0.1`。

Full mode 启用后，ChatCrystal MCP 暴露：

- `search_knowledge`
- `get_note`
- `list_notes`
- `get_relations`
- `recall_for_task`
- `write_task_memory`

## Degraded Mode

如果 ChatCrystal Core 或 MCP 不可用：

- recall skills 应继续工作，但不能声称已经召回记忆
- writeback 只有在 `write_task_memory` 实际成功时才能声称已持久化
- auto writeback 需要稳定 run key；没有 run key 时，应输出 memory candidate，而不是静默切换为 manual persistence

这些 skills 不会在自身工作流中自动运行 ChatCrystal 安装命令。

## 发布建议

当前推荐的 source of truth 是本仓库。初始发布不需要单独的 `chatcrystal-skills` 仓库，因为 skills 生态可以从多 skill GitHub 仓库中安装指定 skill。

本仓库发布规范：

- 每个可发布 skill 都放在 `skills/` 下的受版本管理子目录中
- 每个 skill 保持自包含，包含 `SKILL.md` 和可选的 `agents/` metadata
- 避免依赖 `.agents/` 或 `docs/superpowers/` 这类被忽略的本地目录
- 仓库内受版本管理的文档要与实际 MCP surface 保持一致

如果未来 skill 的发布节奏、贡献模型或品牌定位与 ChatCrystal Core 明显分离，再重新评估是否需要独立 skills 仓库。

