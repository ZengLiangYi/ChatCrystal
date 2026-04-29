# ChatCrystal 开发者指南

[English](DEVELOPMENT.md) | 简体中文

本文档说明仓库结构、架构、开发命令、测试和发布流程。

## 项目概览

ChatCrystal 是一个本地优先的 AI 对话经验沉淀工具。它从 AI 编程工具中导入对话，用 LLM 生成结构化笔记，为语义搜索建立 Embedding，并同时提供 UI、CLI 和 MCP 工作流。

## Monorepo 结构

```
ChatCrystal/
├── shared/                  # 共享 TypeScript 类型
├── server/                  # Fastify 后端、CLI、MCP server
├── client/                  # React SPA
├── electron/                # Electron main/preload 进程
├── skills/                  # 可发布的 ChatCrystal agent skills
├── docs/                    # 用户与维护者文档
├── scripts/                 # 发布与辅助脚本
└── site/                    # 项目官网
```

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js, Fastify v5, TypeScript |
| 前端 | Vite v8, React 19, Tailwind CSS v4, TanStack React Query v5 |
| 桌面 | Electron, electron-builder |
| 数据库 | sql.js WASM SQLite |
| LLM | Vercel AI SDK v6 |
| Embeddings | vectra 本地向量索引 |
| 队列 | p-queue |
| 文件监听 | chokidar |

## 开发命令

```bash
npm run dev                   # Server 3721 + client 13721
npm run build                 # 构建 server 和 client
npm start                     # 生产 server
npm run lint                  # Biome + client ESLint
npm run lint:fix              # 应用安全 lint 修复
npm run test -w server        # Server 测试
npm run dev:electron          # Electron 开发模式
npm run build:electron        # 构建 Windows 安装包
npm run pack:electron         # 构建未打包 Electron 应用
npm run eval:experience -w server
```

`npm run eval:experience -w server` 用于运行经验质量门槛的离线校准样本。

## 运行时数据

运行时数据保存在当前数据目录下的 `config.json` 和 `chatcrystal.db`。

默认数据目录：

- CLI、MCP、npm 包、仓库 checkout 和 Electron：`~/.chatcrystal/data`
- 显式覆盖：`DATA_DIR`

Electron 会按需设置 `ELECTRON=true`、`DATA_DIR` 和 `ELECTRON_PACKAGED`。

## 数据流

```
AI 工具对话文件
  -> SourceAdapter scan/parse
  -> Import service 去重
  -> SQLite conversations/messages
  -> Summarization queue
  -> LLM 结构化笔记生成
  -> Embedding 生成
  -> vectra 语义索引
  -> REST API, UI, CLI, MCP
```

## 摘要流水线

ChatCrystal 在摘要前使用 turn-based 对话预处理：

1. 将消息切分为 user-assistant turn。
2. 每个 turn 保留用户指令和助手首尾两条实质回复。
3. 根据指令长度和助手参与度给 turn 评分。
4. 固定保留第一个 turn 和最后几个 turn。
5. 剩余预算给高价值中间 turn。
6. 被跳过的 turn 压缩成单行预览。

结构化输出使用 Vercel AI SDK 的 `generateObject()` 和 Zod schema。这样可以避免脆弱的 JSON 提取，并在模型输出不符合 schema 时自动重试。

## 数据源适配器

新增数据源需要实现 `SourceAdapter`：

```typescript
interface SourceAdapter {
  name: string;
  displayName: string;
  detect(): Promise<SourceInfo | null>;
  scan(): Promise<ConversationMeta[]>;
  parse(meta: ConversationMeta): Promise<ParsedConversation>;
}
```

内置适配器：

| Adapter | 数据源 | 格式 |
|---|---|---|
| `claude-code` | `~/.claude/projects/**/*.jsonl` | JSONL 对话日志 |
| `codex` | `~/.codex/sessions/**/rollout-*.jsonl` | JSONL 事件流 |
| `cursor` | Cursor `workspaceStorage/state.vscdb` | SQLite KV store |
| `trae` | Trae `workspaceStorage/state.vscdb` | SQLite KV store |
| `copilot` | VS Code `workspaceStorage/chatSessions/*.jsonl` | JSONL 快照 |

在 `server/src/parser/adapters/` 下创建适配器，并注册到 `server/src/parser/index.ts`。

## API 面

主要 REST endpoints：

| Method | Path | Description |
|---|---|---|
| GET | `/api/status` | 服务状态与统计 |
| GET | `/api/config` | 当前配置，密钥已脱敏 |
| POST | `/api/config` | 更新 Provider 配置 |
| POST | `/api/import/scan` | 触发导入 |
| GET | `/api/conversations` | 对话列表 |
| GET | `/api/conversations/:id` | 对话详情 |
| POST | `/api/conversations/:id/summarize` | 摘要单条对话 |
| POST | `/api/summarize/batch` | 批量摘要 |
| GET | `/api/notes` | 笔记列表 |
| GET | `/api/notes/:id` | 笔记详情 |
| GET | `/api/search?q=...&expand=true` | 语义搜索 |
| GET | `/api/relations/graph` | 知识图谱数据 |
| GET | `/api/queue/status` | 队列状态 |

## 知识图谱

关系系统支持以下类型：

| Relation | 含义 |
|---|---|
| `CAUSED_BY` | 因果 |
| `LEADS_TO` | 导致 |
| `RESOLVED_BY` | 被解决 |
| `SIMILAR_TO` | 主题相似 |
| `CONTRADICTS` | 矛盾 |
| `DEPENDS_ON` | 依赖 |
| `EXTENDS` | 扩展 |
| `REFERENCES` | 引用 |

关系可以由 LLM 发现、手动添加，也可以在语义搜索扩展结果时被跟随。

## 测试

主要验证命令：

```bash
npm run test -w server
npm run build
npm run lint
npm run eval:experience -w server
```

开发时可以先跑聚焦测试，提交前再跑完整命令。

## 发布

```bash
npm run release
npm run release -- minor
npm run release -- major
npm run release -- 1.0.0
```

发布脚本会更新版本、创建 git tag 并 push，随后由 CI 构建和发布产物。

