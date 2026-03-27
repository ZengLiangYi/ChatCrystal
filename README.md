# ChatCrystal

从 AI 对话中提炼自己的知识库。

ChatCrystal 将散落在 Claude Code、Cursor 等 AI 编程工具中的对话统一采集到本地，用 LLM 提炼为可搜索的结构化技术笔记，形成个人知识库。

## 核心功能

- **对话采集** — 自动扫描并导入 Claude Code 对话记录（JSONL），支持文件监听实时同步
- **LLM 摘要** — 通过 Vercel AI SDK 接入 Ollama/OpenAI/Anthropic 等，将对话提炼为结构化笔记（标题、摘要、关键结论、代码片段、标签）
- **语义搜索** — 基于 Embedding + 向量索引（vectra），按语义相关度检索笔记
- **对话浏览** — Markdown 渲染、代码高亮、工具调用折叠，噪音过滤
- **系统托盘** — Windows 托盘图标，后台静默运行，崩溃自动重启

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js + Fastify + TypeScript |
| 前端 | Vite + React 19 + Tailwind CSS v4 |
| 数据库 | sql.js (WASM SQLite) |
| LLM | Vercel AI SDK (`ai`) — Ollama / OpenAI / Anthropic / Custom |
| Embedding | Ollama nomic-embed-text + vectra 向量索引 |
| 文件监听 | chokidar |
| 系统托盘 | PowerShell + WinForms NotifyIcon |

## 快速开始

### 前置依赖

- Node.js >= 20
- [Ollama](https://ollama.ai/) 已安装并运行

```bash
# 拉取所需模型
ollama pull qwen2.5:7b          # LLM 摘要
ollama pull nomic-embed-text     # Embedding
```

### 安装

```bash
git clone https://github.com/你的用户名/ChatCrystal.git
cd ChatCrystal
npm install
cp .env.example .env             # 按需修改配置
```

### 开发模式

```bash
npm run dev                      # 同时启动后端 (3721) + 前端 (13721)
```

访问 http://localhost:13721

### 生产模式

```bash
npm run build                    # 构建前后端
npm start                        # 启动服务（前端由后端静态托管）
```

访问 http://localhost:3721

### 系统托盘（Windows）

```bash
npm run tray                     # 启动托盘应用（含服务）
npm run tray:silent              # 静默启动（无窗口弹出）
```

双击桌面快捷方式即可启动。右键托盘图标可：
- 打开浏览器
- 启停服务
- 切换开机自启
- 退出

## 使用流程

1. 启动后，点击侧边栏「导入对话」扫描 Claude Code 对话
2. 在「对话」页浏览已导入的对话
3. 点击「生成摘要」或使用「批量生成」将对话提炼为笔记
4. 在「搜索」页通过语义搜索查找知识
5. 在「笔记」页按标签筛选和浏览所有笔记

## 配置

编辑 `.env` 文件：

```bash
# 服务端口
PORT=3721

# Claude Code 数据源
CLAUDE_PROJECTS_DIR=~/.claude/projects

# LLM 摘要（支持 ollama/openai/anthropic/google/custom）
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434
LLM_MODEL=qwen2.5:7b

# Embedding
EMBEDDING_PROVIDER=ollama
EMBEDDING_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text
```

使用 Poe / OpenRouter 等 OpenAI 兼容服务：
```bash
LLM_PROVIDER=custom
LLM_BASE_URL=https://api.poe.com/bot
LLM_API_KEY=你的key
LLM_MODEL=Claude-3.5-Haiku
```

## 项目结构

```
ChatCrystal/
├── shared/types/        # 共享 TypeScript 类型
├── server/src/
│   ├── db/              # SQLite schema + 工具函数
│   ├── parser/          # 插件式对话解析器（SourceAdapter）
│   ├── services/        # 导入、摘要、LLM、Embedding
│   ├── routes/          # Fastify API 路由
│   ├── watcher/         # chokidar 文件监听
│   └── queue/           # p-queue 任务队列
├── client/src/
│   ├── pages/           # 页面组件
│   ├── components/      # 通用组件
│   ├── hooks/           # React Query hooks
│   ├── themes/          # 主题定义
│   └── providers/       # ThemeProvider
├── scripts/             # 托盘、启动脚本
└── data/                # 运行时数据（gitignored）
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

## License

MIT
