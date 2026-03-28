# ChatCrystal

从 AI 对话中提炼自己的知识库。

ChatCrystal 将散落在 Claude Code、Cursor 等 AI 编程工具中的对话统一采集到本地，用 LLM 提炼为可搜索的结构化技术笔记，形成个人知识库。

## 核心功能

- **对话采集** — 自动扫描并导入 Claude Code 对话记录（JSONL），支持文件监听实时同步
- **LLM 摘要** — 通过 Vercel AI SDK 接入多种 LLM Provider，将对话提炼为结构化笔记（标题、摘要、关键结论、代码片段、标签）
- **语义搜索** — 基于 Embedding + 向量索引（vectra），按语义相关度检索笔记
- **对话浏览** — Markdown 渲染、代码高亮、工具调用折叠，噪音过滤
- **多 Provider 支持** — 支持 Ollama、OpenAI、Anthropic、Google AI、Azure OpenAI 及任意 OpenAI 兼容服务，可在设置页面运行时切换
- **任务队列** — 批量摘要/Embedding 生成通过 p-queue 排队执行，支持实时进度追踪和取消
- **桌面应用** — Electron 打包，系统托盘驻留，关闭窗口最小化到托盘

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

1. 启动后，点击侧边栏「导入对话」扫描 Claude Code 对话
2. 在「对话」页浏览已导入的对话
3. 点击「生成摘要」或使用「批量生成」将对话提炼为笔记
4. 在「搜索」页通过语义搜索查找知识
5. 在「笔记」页按标签筛选和浏览所有笔记
6. 在「设置」页切换 LLM/Embedding Provider 和模型

## 配置

可通过 `.env` 文件或设置页面（运行时热切换）配置：

```bash
# 服务端口
PORT=3721

# Claude Code 数据源
CLAUDE_PROJECTS_DIR=~/.claude/projects

# LLM 摘要（支持 ollama/openai/anthropic/google/azure/custom）
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434
LLM_MODEL=qwen2.5:7b

# Embedding（支持 ollama/openai/google/azure/custom）
EMBEDDING_PROVIDER=ollama
EMBEDDING_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text
```

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
│   ├── parser/              # 插件式对话解析器（SourceAdapter）
│   ├── services/            # 导入、摘要、LLM、Embedding、Provider
│   ├── routes/              # Fastify API 路由
│   ├── watcher/             # chokidar 文件监听
│   └── queue/               # p-queue 任务队列 + TaskTracker
├── client/src/
│   ├── pages/               # 页面组件（Dashboard、对话、笔记、搜索、设置）
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

在 `server/src/parser/adapters/` 下新建适配器文件，注册到 `parser/registry.ts`。

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
| GET | `/api/search?q=...` | 语义搜索 |
| GET | `/api/tags` | 标签列表 |
| GET | `/api/queue/status` | 队列状态 |
| POST | `/api/queue/cancel` | 取消排队中的任务 |

## License

[MIT](LICENSE)
