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
| 数据库 | `node:sqlite`（内置 SQLite，WAL）；parser 侧 SQLite 读取仍用 sql.js |
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
pnpm test                             # 全部测试（含依赖审计策略）
pnpm test:server                      # 仅 Server 测试
pnpm test:client                      # 仅 Client 测试
pnpm test:electron                    # 仅 Electron 测试
pnpm dev:electron                     # Electron 开发模式
pnpm build:electron                   # 构建 Windows 安装包
pnpm pack:electron                    # 构建未打包 Electron 应用
pnpm --filter ./server smoke:mcp      # MCP 端到端冒烟测试（先执行 build）
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
  -> SourceAdapter detect/scan（只读元数据，不读正文）
  -> 后台同步引擎（启动一次 + watcher 定向触发；同一时间只跑一轮）
  -> SourceAdapter 在 worker 线程池中 parse
  -> Import service 去重
  -> SQLite（node:sqlite, WAL）conversations/messages
  -> Summarization queue
  -> LLM 结构化笔记生成
  -> Embedding 生成
  -> vectra 语义索引
  -> REST API, UI, CLI, MCP
```

## 后台同步与解析

- `services/sync.ts` 是唯一的导入入口：一个小型状态机（`idle`/`syncing`/`cancelled`/`error`），带每源进度和触发合并。`createServer` 在启动 2.5s 后调度一轮；watcher 触发时只请求受影响的源。客户端轮询 `GET /api/sync/status`；`POST /api/sync/start`、`POST /api/sync/cancel` 可手动控制，`GET /api/sync/stream` 是 SSE 版本。
- watcher 在第一轮启动同步结束后才开始。否则 chokidar 对超大目录（例如 workbuddy home 里的 7 万个插件文件）的首次扫描会与导入的 fs 读取争抢线程池。事件按最长前缀映射到所属 source，并 debounce 1.8s。
- `importAll()` 接受 `{ sources?, signal?, onProgress?, parsePool? }`，发出阶段/每源进度与错误明细；旧的 `importAll(callback)` 仍兼容 CLI/SSE。
- 解析默认走共享的 `services/parse-pool.ts` worker 池（`CHATCRYSTAL_PARSE_WORKERS`，默认 `min(4, CPUs-1)`；`0` 或 `CHATCRYSTAL_PARSE_POOL=off` 则主线程解析）。测试在 `NODE_TEST_CONTEXT` 下始终 inline，因为测试注册的 fake adapter 不在 worker 里。
- `CHATCRYSTAL_AUTO_SYNC=0` 可关闭启动/watcher 自动同步；手动同步和 `crystal import` 不受影响。

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
  parserVersion?: string;
  detect(): Promise<SourceInfo | null>;
  scan(): Promise<ConversationMeta[]>;
  parse(meta: ConversationMeta): Promise<ParsedConversation>;
  /** 可选：供 watcher 使用的 chokidar 监听目标。 */
  watchPaths?(): string[];
}
```

内置适配器：

| Adapter | 数据源 | 格式 |
|---|---|---|
| `claude-code` | `~/.claude/projects/**/*.jsonl` | JSONL 对话日志 |
| `codex` | `~/.codex/sessions/**/rollout-*.jsonl[.zst]` + `archived_sessions/` | JSONL 事件流（旧 `event_msg` 与 0.160+ `item_completed` 两种格式，支持多帧 zstd） |
| `cursor` | Cursor `workspaceStorage/state.vscdb` | SQLite KV store |
| `trae` | Trae `workspaceStorage/state.vscdb` | SQLite KV store |
| `copilot` | VS Code `workspaceStorage/chatSessions/*.jsonl` | JSONL 快照 |
| `gemini` | `~/.gemini/tmp/*/chats/session-*.{json,jsonl}` | 会话 JSON / 回放 JSONL |
| `qwen` | `~/.qwen/projects/*/chats/*.jsonl` | Claude 风格 JSONL |
| `opencode` | `~/.local/share/opencode/opencode.db`（或 `storage/**/*.json`） | SQLite / JSON 文档 |
| `cline` | `~/.cline/data/sessions/*/*.messages.json`、VS Code 扩展 `tasks/*` | 整文件 JSON |
| `roo` | `<VS Code User>/globalStorage/rooveterinaryinc.roo-cline/tasks/*` | 整文件 JSON |
| `kilo` | `<VS Code User>/globalStorage/kilocode.kilo-code/tasks/*` | 整文件 JSON |
| `copilot-cli` | `~/.copilot/session-state/*/events.jsonl` | 事件 JSONL |
| `continue` | `~/.continue/sessions/*.json` | 整文件 JSON |
| `dsh` | `~/.dsh/sessions/**/session.v<N>.jsonl[.zstd]` | JSONL（多帧 zstd） |
| `workbuddy` | `~/.workbuddy(-ai)/projects/*/*.jsonl` | JSONL（OpenAI Agents items） |
| `antigravity` | `~/.gemini/antigravity/brain/*/.system_generated/logs/transcript.jsonl` | 步骤 JSONL |
| `droid` | `~/.factory/sessions/**/*.jsonl` | 事件 JSONL |
| `goose` | `~/.local/share/goose/sessions/sessions.db`（或 `*.jsonl`） | SQLite / JSONL |
| `pi` | `~/.pi/agent/sessions/*/*.jsonl` | JSONL（session header + messages） |
| `omp` | `~/.omp/agent/sessions/*` + profiles | Pi 格式 JSONL |
| `raft` | `~/.slock/agents/*/.pi-sessions|.builtin-sessions/*.jsonl` | Pi 格式 JSONL |
| `cindy` | `<config>/Cindy*/pi-agent-home/sessions/*.jsonl` | Pi 格式 JSONL |
| `qoder` / `qoder-cn` | `~/.qoder(-cn)/projects/*/*.jsonl` | Claude 风格 JSONL |
| `codebuddy` | `~/.codebuddy/projects/*/*.jsonl` | JSONL（OpenAI Agents items，与 WorkBuddy 相同） |
| `claude-desktop` | `<Claude data>/local-agent-mode-sessions/*/*/local_*/.claude/projects/*` | Claude 风格 JSONL |
| `zcode` | `~/.zcode/cli/db/db.sqlite` | OpenCode schema（SQLite） |
| `hermes` | `~/.hermes/state.db` | SQLite sessions/messages |
| `alma` | `<config>/alma/chat_threads.db` | SQLite threads/messages |
| `grok` | `~/.grok/sessions/<cwd>/<id>/updates.jsonl` | ACP update JSONL + summary.json |
| `kimi` | `~/.kimi-code/sessions/*/*/agents/main/wire.jsonl` | Wire JSONL + state.json |
| `minimax-code` | `~/.minimax/v2/sessions/**/messages*.jsonl` | JSONL messages |

在 `server/src/parser/adapters/` 下创建适配器，注册到 `server/src/parser/index.ts`，并把 source id 加入 `server/src/config.ts` 的 `ALL_SOURCE_NAMES`（该列表同时驱动 `enabledSources` 迁移与远端导入校验）。

### Windows 上的 WSL 多根扫描

基于文件的适配器还能读取装在 WSL 发行版里的同一个 Agent。`parser/wsl.ts` 会发现正在运行的发行版 home（`\\wsl.localhost\<distro>\home\<user>`），`parser/sourceRoots.ts` 提供 `withWslRoots(primaryDir, '<相对路径>')` / `wslRootsFor('<相对路径>')`：

```typescript
const roots = withWslRoots(appConfig.codexSessionsDir, '.codex/sessions');
for (const root of roots) {
  // 扫描 root
}
```

- `withWslRoots` 永远把主根放在第一位；只有当 `<发行版 home>/<相对路径>` 存在时才追加 WSL 根。
- `scan()` 应为每个 `ConversationMeta` 设置 `rootDir: root`；`parse()` 需要根级元数据时用 `meta.rootDir ?? appConfig.<主根>`（Gemini `projects.json`、Antigravity 摘要 DB、Continue `sessions.json`、Cline 扩展 `taskHistory.json` 等）。
- `watchPaths()` 只返回本地根：watcher 不监听 UNC 路径（慢，且可能启动已停止的发行版）。
- `watchPaths()` 应指向最窄的会话目录而不是 Agent home。chokidar 必须先扫描 target 才能监听；过宽的 target（例如带插件市场的 `~/.workbuddy`）会拖垮首轮导入的 fs 读取。
- 发现逻辑支持 `CHATCRYSTAL_WSL=0`（禁用）、`CHATCRYSTAL_WSL_DISTROS`（指定发行版，访问时可能启动）、`CHATCRYSTAL_WSL_HOMES`（强制 home）。测试用 `setWslHomesForTesting([...])` 注入 fixture home。

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
pnpm --filter ./server smoke:mcp
pnpm lint
pnpm --filter ./server eval:experience
pnpm security:audit
pnpm security:signatures
```

开发时可以先跑单层聚焦测试，提交前再跑完整命令。MCP 冒烟测试使用编译产物，因此需要先执行 `pnpm build`。

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
