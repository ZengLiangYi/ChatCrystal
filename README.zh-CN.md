<div align="center">

<img src="electron/icon.png" alt="ChatCrystal" width="120" />

# ChatCrystal

**从 AI 对话中提炼自己的知识库**

[![GitHub release](https://img.shields.io/github/v/release/ZengLiangYi/ChatCrystal?style=flat-square)](https://github.com/ZengLiangYi/ChatCrystal/releases)
[![npm](https://img.shields.io/npm/v/chatcrystal?style=flat-square)](https://www.npmjs.com/package/chatcrystal)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey?style=flat-square)](#)
[![Website](https://img.shields.io/badge/website-ChatCrystal-5A5FD6?style=flat-square)](https://zengliangyi.github.io/ChatCrystal/zh/)

[English](README.md) | 简体中文

</div>

---

<div align="center">
<img src="docs/demo.webp" alt="ChatCrystal 演示" width="800" />
</div>

<br>

ChatCrystal 将散落在 Claude Code、Cursor、Codex CLI、Trae、GitHub Copilot 等 AI 编程工具中的对话统一采集到本地，用 LLM 提炼为可搜索的结构化技术笔记，形成个人知识库。

<div align="center">
<table>
<tr>
<td align="center"><strong>对话浏览</strong></td>
<td align="center"><strong>笔记摘要</strong></td>
</tr>
<tr>
<td><img src="docs/screenshots/zh-CN/conversations.png" alt="对话浏览" width="400" /></td>
<td><img src="docs/screenshots/zh-CN/notes.png" alt="笔记摘要" width="400" /></td>
</tr>
<tr>
<td align="center"><strong>语义搜索</strong></td>
<td align="center"><strong>知识图谱</strong></td>
</tr>
<tr>
<td><img src="docs/screenshots/zh-CN/search.png" alt="语义搜索" width="400" /></td>
<td><img src="docs/screenshots/zh-CN/graph.png" alt="知识图谱" width="400" /></td>
</tr>
</table>
</div>

## 核心功能

- **多数据源采集** — 自动扫描并导入 Claude Code、Codex CLI、Cursor、Trae、GitHub Copilot 的对话记录，支持文件监听实时同步
- **结构化 LLM 摘要** — 通过 `generateObject` + Zod Schema 生成笔记（保证输出结构合法，schema 校验失败自动重试）。Turn-based 对话预处理算法在可配置的 token 预算内选择最有价值的对话片段。
- **语义搜索** — 基于 Embedding + 向量索引（vectra），搜索结果包含文本预览，支持沿关系边扩展。Embedding 内容涵盖标题、摘要、结论、标签和代码片段描述。
- **知识图谱** — 通过 `generateObject` + 类型化 Schema 发现笔记关系。8 种关系类型 + 置信度评分 + 力导向图可视化。
- **对话浏览** — Markdown 渲染、代码高亮、工具调用折叠，噪音过滤
- **多 Provider 支持** — 支持 Ollama、OpenAI、Anthropic、Google AI、Azure OpenAI 及任意 OpenAI 兼容服务，可在设置页面运行时切换
- **任务队列** — 批量摘要/Embedding 生成通过 p-queue 排队执行，支持实时进度追踪和取消
- **桌面应用** — Electron 打包，系统托盘驻留，关闭窗口最小化到托盘

## 摘要引擎原理

ChatCrystal 通过多阶段流水线将原始对话转化为可搜索的知识：

### Turn-Based 对话预处理

AI 编程对话有天然的 **turn 结构** — 用户发指令，助手响应（可能包含大量工具调用），然后循环。长对话（100+ 消息，大量 MCP 工具调用）无法塞进单次 LLM 上下文窗口。

相比简单的首尾截断，ChatCrystal 使用 **Turn-Based 选择算法**：

1. **分割** — 在用户→助手边界处将消息分组为 turn。连续用户消息（如粘贴日志 + 补充说明）归入同一个 turn。
2. **过滤** — 每个 turn 内只保留用户指令 + 助手的首条和末条实质回复，中间的工具调用链全部砍掉。
3. **评分** — 每个 turn 的分数 = `用户消息总长度 × (1 + 助手回复条数)`。越长的指令 + 越多的助手交互 = 越重要。
4. **选择** — 第一个 turn（需求描述）和最后两个 turn（最终结论）固定保留。剩余预算分配给评分最高的中间 turn。
5. **摘要压缩** — 被跳过的 turn 压缩为单行概要（`[跳过] 用户: 修复登录页面的 CSS 样式问题...`），让 LLM 仍能看到对话的因果链。

字符预算默认 32,000（约 8K tokens），可通过 `LLM_MAX_INPUT_CHARS` 配置，适配大上下文模型。

### 结构化输出

摘要生成使用 Vercel AI SDK 的 `generateObject()` + Zod Schema，而非依赖 prompt 工程让模型"自觉"输出 JSON。Schema 校验失败时自动重试（最多 3 次），彻底消除了 `generateText()` + 手动 JSON 解析带来的截断和解析失败问题。

## CLI 与 MCP Server

ChatCrystal 同时提供 CLI 工具和 MCP Server，已发布为 npm 包。

```bash
npm install -g chatcrystal
```

### CLI 命令

```bash
crystal status                          # 服务器状态与数据库统计
crystal import [--source claude-code]   # 扫描并导入对话
crystal search "关键词" [--limit 10]     # 语义搜索
crystal notes list [--tag 标签名]        # 浏览笔记
crystal notes get <id>                  # 查看笔记详情
crystal tags                            # 列出所有标签
crystal summarize --all                 # 批量生成摘要
crystal config get                      # 查看配置
crystal serve -d                        # 后台启动服务器
crystal serve stop                      # 停止后台服务器
```

自动拉起：需要服务器的命令会在服务未运行时自动后台启动。输出根据终端自动适配 — 终端中显示彩色表格，管道/重定向时输出 JSON。

### MCP Server

与 AI 编码工具（Claude Code、Cursor 等）集成，让它们在编码过程中直接检索你的对话知识库。

```bash
crystal mcp                             # 启动 MCP stdio 服务
```

**Claude Code 配置**（`settings.json`）：
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

MCP 暴露 6 个工具：只读知识工具 `search_knowledge`、`get_note`、`list_notes`、`get_relations`，以及 memory loop 工具 `recall_for_task`、`write_task_memory`。

正式可移植的 ChatCrystal skills 位于 [`skills/`](skills/)，安装与发布说明见 [`docs/agent-skills.md`](docs/agent-skills.md)。

### Memory Loop 架构概览

ChatCrystal 的 agent memory loop 分成三层：

- **ChatCrystal Core** — 负责本地知识存储、检索、merge 与 writeback
- **MCP Layer** — 暴露稳定工具接口，包括知识查询、task recall 与 task writeback
- **Skill Layer** — 以可移植 skill 的形式，在开工前触发 recall、在任务完成后触发 writeback

当 Core 不可用时，skill 会安全降级：继续帮助完成任务，但不会伪装成“已经完成记忆召回或持久化”。

安装方式、full mode、degraded mode 和发布说明见 [`docs/agent-skills.md`](docs/agent-skills.md)。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js + Fastify v5 + TypeScript |
| 前端 | Vite v8 + React 19 + Tailwind CSS v4 + TanStack React Query v5 |
| 桌面 | Electron + electron-builder (NSIS 安装包) |
| 数据库 | sql.js (WASM SQLite) |
| LLM | Vercel AI SDK v6 — Ollama / OpenAI / Anthropic / Google / Azure / Custom |
| Embedding | vectra 向量索引，支持多 Provider |
| 文件监听 | chokidar |

## 快速开始

### 前置依赖

- Node.js >= 20
- LLM 服务（以下任选其一）：
  - [Ollama](https://ollama.ai/)（本地推理，免费）
  - OpenAI / Anthropic / Google AI API Key
  - 任意 OpenAI 兼容服务（OpenRouter、Poe 等）

使用 Ollama 时，拉取所需模型：

```bash
ollama pull qwen2.5:7b          # LLM 摘要
ollama pull nomic-embed-text     # Embedding
```

### 安装

```bash
git clone https://github.com/ZengLiangYi/ChatCrystal.git
cd ChatCrystal
npm install
cp .env.example .env             # 按需修改配置
```

### 桌面应用（推荐）

```bash
npm run dev:electron             # 开发模式（Electron + Vite HMR）
npm run build:electron           # 构建 NSIS 安装包 → release/
```

构建后的安装包在 `release/` 目录。安装后数据存储在 `%APPDATA%/chatcrystal/data/`。

### Web 开发模式

```bash
npm run dev                      # 同时启动后端 (3721) + 前端 (13721)
```

访问 http://localhost:13721

### Web 生产模式

```bash
npm run build                    # 构建前后端
npm start                        # 启动服务（前端由后端静态托管）
```

访问 http://localhost:3721

## 使用流程

1. 启动后，点击侧边栏「导入对话」扫描 Claude Code / Codex CLI / Cursor / Trae / GitHub Copilot 对话
2. 在「对话」页浏览已导入的对话
3. 点击「生成摘要」或使用「批量生成」将对话提炼为笔记
4. 在「搜索」页通过语义搜索查找知识，可勾选「展开关联笔记」沿关系边扩展结果
5. 在「图谱」页浏览笔记之间的关联关系（力导向图，可拖拽缩放）
6. 在「笔记」页按标签筛选和浏览所有笔记
7. 在「设置」页切换 LLM/Embedding Provider 和模型

## 配置

可通过 `.env` 文件或设置页面（运行时热切换）配置：

```bash
# 服务端口
PORT=3721

# 数据源
CLAUDE_PROJECTS_DIR=~/.claude/projects
CODEX_SESSIONS_DIR=~/.codex/sessions
# CURSOR_DATA_DIR=          # 按平台自动检测，可手动覆盖

# LLM 摘要（支持 ollama/openai/anthropic/google/azure/custom）
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434
LLM_MODEL=qwen2.5:7b
# LLM_MAX_INPUT_CHARS=32000   # 大上下文模型可调大（如 128K 模型设为 80000）

# Embedding（支持 ollama/openai/google/azure/custom）
EMBEDDING_PROVIDER=ollama
EMBEDDING_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text
```

> **注意：LLM 与 Embedding 需要分别配置。** 语义搜索要求 Embedding 模型支持 `/v1/embeddings` 端点。大语言模型（如 Claude、GPT-4、Qwen）**不能**用作 Embedding 模型。常见可用的 Embedding 模型：
>
> | Provider | 模型 |
> |----------|------|
> | Ollama（本地） | `nomic-embed-text`、`mxbai-embed-large` |
> | OpenAI | `text-embedding-3-small`、`text-embedding-3-large` |
> | Google | `text-embedding-004` |

### Provider 配置示例

```bash
# OpenAI
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o

# Anthropic
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-20250514

# Google AI
LLM_PROVIDER=google
LLM_API_KEY=AIza...
LLM_MODEL=gemini-2.0-flash

# OpenAI 兼容服务（Poe / OpenRouter 等）
LLM_PROVIDER=custom
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=你的key
LLM_MODEL=anthropic/claude-sonnet-4
```

## 项目结构

```
ChatCrystal/
├── electron/                # Electron 主进程（窗口、托盘、生命周期）
├── shared/types/            # 共享 TypeScript 类型
├── server/src/
│   ├── db/                  # SQLite schema + 工具函数
│   ├── parser/              # 插件式对话解析器（Claude Code / Codex / Cursor / Trae / Copilot）
│   ├── services/            # 导入、摘要、LLM、Embedding、关系发现、Provider
│   ├── routes/              # Fastify API 路由
│   ├── watcher/             # chokidar 文件监听
│   └── queue/               # p-queue 任务队列 + TaskTracker
├── client/src/
│   ├── pages/               # 页面组件（Dashboard、对话、笔记、搜索、图谱、设置）
│   ├── components/          # 通用组件（StatusBar、ActivityPanel 等）
│   ├── hooks/               # React Query hooks
│   ├── themes/              # 主题定义
│   └── providers/           # ThemeProvider
├── scripts/                 # 旧版托盘脚本（已被 Electron 替代）
├── electron-builder.yml     # Electron 打包配置
└── data/                    # 运行时数据（gitignored）
```

## 扩展数据源

实现 `SourceAdapter` 接口即可接入新的 AI 工具对话：

```typescript
interface SourceAdapter {
  name: string;
  displayName: string;
  detect(): Promise<SourceInfo | null>;
  scan(): Promise<ConversationMeta[]>;
  parse(meta: ConversationMeta): Promise<ParsedConversation>;
}
```

目前已内置五个适配器：

| 适配器 | 数据源 | 格式 |
|---|---|---|
| `claude-code` | `~/.claude/projects/**/*.jsonl` | JSONL 对话记录 |
| `codex` | `~/.codex/sessions/**/rollout-*.jsonl` | JSONL 事件流 |
| `cursor` | Cursor `workspaceStorage/state.vscdb` | SQLite KV 存储 |
| `trae` | Trae `workspaceStorage/state.vscdb` | SQLite KV 存储 |
| `copilot` | VS Code `workspaceStorage/chatSessions/*.jsonl` | JSONL 会话快照 |

在 `server/src/parser/adapters/` 下新建适配器文件，注册到 `parser/index.ts`。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/status` | 服务状态 + 统计 |
| GET | `/api/config` | 当前配置（不含密钥） |
| POST | `/api/config` | 更新 Provider 配置 |
| POST | `/api/config/test` | 测试 LLM 连接 |
| GET | `/api/providers` | 可用 Provider 列表 |
| POST | `/api/import/scan` | 触发全量扫描导入 |
| GET | `/api/conversations` | 对话列表（支持筛选分页） |
| GET | `/api/conversations/:id` | 对话详情 + 消息 |
| POST | `/api/conversations/:id/summarize` | 生成单条摘要 |
| POST | `/api/summarize/batch` | 批量生成摘要 |
| POST | `/api/summarize/reset-errors` | 重置错误状态 |
| GET | `/api/notes` | 笔记列表 |
| GET | `/api/notes/:id` | 笔记详情 |
| POST | `/api/notes/:id/embed` | 生成 Embedding |
| POST | `/api/embeddings/batch` | 批量生成 Embedding |
| GET | `/api/search?q=...&expand=true` | 语义搜索（expand 展开关联笔记） |
| GET | `/api/notes/:id/relations` | 笔记关联列表 |
| POST | `/api/notes/:id/relations` | 手动创建关联 |
| DELETE | `/api/relations/:id` | 删除关联 |
| POST | `/api/notes/:id/discover-relations` | LLM 自动发现关联 |
| POST | `/api/relations/batch-discover` | 批量发现关联 |
| GET | `/api/relations/graph` | 知识图谱数据（nodes + edges） |
| GET | `/api/tags` | 标签列表 |
| GET | `/api/queue/status` | 队列状态 |
| POST | `/api/queue/cancel` | 取消排队中的任务 |

## 知识图谱

笔记生成摘要后，LLM 会自动分析其与已有笔记之间的关系。支持以下关系类型：

| 关系 | 含义 | 示例 |
|------|------|------|
| `CAUSED_BY` | 因果关系 | 登录失败 ← Token 过期逻辑改错 |
| `LEADS_TO` | 导致 | 重构路由 → 页面闪烁 bug |
| `RESOLVED_BY` | 被解决 | 内存泄漏 → 添加 cleanup 函数 |
| `SIMILAR_TO` | 主题相似 | 两次对话都在讨论部署流程 |
| `CONTRADICTS` | 观点矛盾 | 用 Redux vs 用 Context 就够了 |
| `DEPENDS_ON` | 依赖 | 新功能依赖 auth 中间件重构 |
| `EXTENDS` | 扩展深化 | 在缓存方案基础上加了淘汰策略 |
| `REFERENCES` | 引用提及 | 对话中提到了之前的架构决策 |

在笔记详情页底部可查看关联笔记，支持 AI 发现、手动添加、搜索选择目标笔记。在「图谱」页可通过力导向图可视化浏览整个知识网络。

## 常见问题

**语义搜索返回 500 "Not Found"**

Embedding 模型配置错误。确保 `EMBEDDING_MODEL` 使用的是专用 Embedding 模型（如 `nomic-embed-text`），而不是大语言模型（如 `claude-haiku`、`qwen2.5`）。大语言模型不支持 `/v1/embeddings` 端点。

**启动时连不上 Ollama**

确保 Ollama 服务已启动，且模型已拉取：
```bash
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

**对话导入为空**

检查 `.env` 中 `CLAUDE_PROJECTS_DIR` 路径是否正确，确保对应目录下有 `.jsonl` 文件。

**知识图谱为空**

需要先生成笔记，再在笔记详情页点击「发现」，或使用 `POST /api/relations/batch-discover` 批量发现关联。

## License

[MIT](LICENSE)
