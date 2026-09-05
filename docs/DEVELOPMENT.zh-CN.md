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
| LLM | Vercel AI SDK v7 |
| Embeddings | vectra 本地向量索引 |
| 队列 | p-queue |
| 文件监听 | chokidar |

## 开发命令

```bash
corepack enable
pnpm install
pnpm dev                              # Server 3721 + client 13721
pnpm build                            # 构建 server 和 client
pnpm start                            # 生产 server
pnpm lint                             # Biome + client ESLint
pnpm lint:fix                         # 应用安全 lint 修复
pnpm test                             # Server 测试
pnpm dev:electron                     # Electron 开发模式
pnpm build:electron                   # 构建 Windows 安装包
pnpm pack:electron                    # 构建未打包 Electron 应用
pnpm --filter ./server eval:experience
pnpm security:audit                   # high/critical 时失败
pnpm security:signatures              # 校验 registry 签名
```

根 workspace 要求 Node.js 24，并通过 Corepack 使用 pnpm 11；`site/` 与 `promo/` 仍是独立 npm 项目。`pnpm --filter ./server eval:experience` 用于运行经验质量门槛的离线校准样本。

### 依赖策略

- root、server、client、shared 与 Electron 构建链只使用 `pnpm-lock.yaml`。
- 保持 pnpm 的 isolated、项目内虚拟存储布局；electron-builder 会依据带版本的真实路径，在存在多个版本时打包正确的生产依赖。
- 新发布版本默认冷却 24 小时；只有时效性安全修复可以添加精确例外，并必须在配置旁说明原因。
- 最近发布包若发生 registry 信任降级会被拒绝，exotic 子依赖会被阻断，依赖生命周期脚本使用显式白名单。
- `pnpm security:audit` 会打印完整审计结果，并在 high 或 critical 发现时失败；`pnpm security:signatures` 用于校验 registry 签名。
- Dependabot 每周检查 workspace 依赖与 GitHub Actions。minor/patch 合并更新，major 保持单独评估。

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

结构化输出使用 Vercel AI SDK 的 `generateText()`、`Output.object()` 和 Zod schema。这样可以避免脆弱的 JSON 提取，并在模型输出不符合 schema 时自动重试。

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
| GET | `/api/graph/projection` | 面向 UI 的有界图谱投影 |
| GET | `/api/relations/graph` | 旧版笔记关系图数据 |
| GET | `/api/queue/status` | 队列状态 |

## 知识图谱

默认图谱 UI 使用 `/api/graph/projection?level=tag`。它以 tag 作为知识点节点，并连接出现在同一篇笔记中的 tag。Tag 边强度使用 `cooccurrence_count / sqrt(tagA_note_count * tagB_note_count)` 归一化，然后在返回前完成过滤和数量限制。

笔记关系图仍通过 `/api/relations/graph` 和 `/api/graph/projection?level=note` 保留，用于兼容旧能力和关联笔记工作流。

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
pnpm test
pnpm build
pnpm lint
pnpm --filter ./server eval:experience
pnpm security:audit
pnpm security:signatures
```

开发时可以先跑聚焦测试，提交前再跑完整命令。

## 发布

```bash
pnpm release                    # 完整发布：npm + Electron，tag v*
pnpm release -- minor
pnpm release -- major
pnpm release -- 1.0.0
pnpm release:electron -- 1.0.1  # 仅 Electron 发布，tag electron-v*
pnpm release:npm -- 1.0.1       # 仅 npm 发布，tag npm-v*
```

发布应使用 `scripts/release.mjs`。除非是在明确的恢复流程中，不要手动改版本、提交、打 tag 再 push。

发布 tag 语义：

- `v*` 会同时触发 npm 发布和 Electron GitHub Release 构建。只有 root `package.json` 和 `server/package.json` 都需要一起升级时才使用。
- `electron-v*` 只触发 Electron GitHub Release 构建。桌面端专属变更应使用它，包括 Electron main/preload/tray/packaging 变更，以及只有 Electron 会启用的 client UI。
- `npm-v*` 只发布 npm 包。CLI、server、MCP 或 npm 包内容变更应使用它。
- npm 包版本来自 `server/package.json`，不是 root `package.json`。如果 `v*` 发布时 `server/package.json` 仍指向已经发布过的版本，npm job 会因 `E403` 失败。
