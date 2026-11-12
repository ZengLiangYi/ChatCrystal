# ChatCrystal 用户指南

[English](USER_GUIDE.md) | 简体中文

本文档说明安装、日常使用、配置和常见问题。

## 安装

### 全局 CLI

```bash
npm install -g chatcrystal
crystal serve -d
crystal import
```

服务启动后打开 http://localhost:3721。

### 从源码运行

```bash
git clone https://github.com/ZengLiangYi/ChatCrystal.git
cd ChatCrystal
corepack enable
pnpm install
pnpm dev
```

开发模式会启动 API 服务 http://localhost:3721 和 Vite 客户端 http://localhost:13721。

### 桌面应用

从 [GitHub Releases](https://github.com/ZengLiangYi/ChatCrystal/releases) 下载 Windows 安装包并启动。本地构建：

```bash
pnpm dev:electron
pnpm build:electron
```

安装包会生成到 `release/`。首次启动时，引导页会让你选择连接**本地核心**（推荐，数据全部留在本机）或已有的**云端核心**（地址 + 访问 token）。选择本地核心，跳过可选的导入/摘要/MCP 步骤并进入应用，启动同步会自动开始。

桌面应用与 CLI、MCP server 使用同一个默认数据目录：`~/.chatcrystal/data`。

## 使用流程

1. 本地历史会自动同步：启动几秒后跑一次，之后会话文件变化时按源定向同步，不需要手动导入。侧边栏会显示同步状态（等待同步 / 同步中带进度 / 上次同步时间），也可以手动触发或取消。全部 32 种 Agent Harness 都会被检测，包括 Claude Code、Claude Desktop、Codex CLI、Cursor、Trae、GitHub Copilot Chat 与 CLI、Gemini CLI、Qwen Code、OpenCode、Cline、Roo Code、Kilo Code、Continue、DeepSeek Harness、WorkBuddy、CodeBuddy、Antigravity、Droid、Goose、Pi、omp、Raft、Cindy、Qoder/Qoder CN、ZCode、Hermes、Alma、Grok Build、Kimi Code、MiniMax Code（Windows 上包含 WSL 发行版 home）。
2. 在 **Conversations** 页面浏览原始对话。
3. 点击 **Summarize** 或批量摘要，生成结构化笔记。
4. 在 **Search** 页面搜索知识；需要更完整上下文时开启关联笔记扩展。
5. 打开图谱视图，浏览 tag 形成的知识点，以及每个知识点下的笔记。
6. 在 **Settings** 页面切换 LLM 和 Embedding Provider。

### 同步状态、索引与懒解析

- **索引优先列表**：某个数据源扫描完成后，每个会话文件立即变成一条对话行，即使正文还在解析。尚未解析完的行会在标题旁显示「索引中」，并且仍然可以点击。
- **懒解析详情**：打开一条「索引中」的行时，会按需解析该会话（本机通常一秒内完成，超大文件或 WSL 文件会稍慢），随后渲染完整对话。行变为 materialized 后标记自动消失。
- **取消也保留进度**：点击侧边栏的**取消**会停止本轮同步，索引行和已解析的对话都会保留；点**重试**可以继续，或直接打开某条 pending 对话单独补全。
- **watcher 是增量的**：首轮同步结束后才开始监听，之后会话文件变化时只触发对应来源的小同步。退出应用才会停止同步，关闭窗口到托盘不会。
- **首轮最耗时**：大历史只在首次完整解析一次，后续启动只处理新增或变化的会话。

### WSL 会话（Windows）

装在 WSL 发行版里的 Agent 会把历史保存在发行版 home 中。Windows 上 ChatCrystal 会通过 `\\wsl.localhost` 读取，并从 WSL 发行版导入 Claude Code、Codex、Gemini CLI、Qwen Code、OpenCode、Cline、Roo Code、Kilo Code、Continue、DeepSeek Harness 等受支持 Agent 的会话。

- 默认只扫描**正在运行**的发行版，不会为了导入而启动已停止的发行版。可用 `CHATCRYSTAL_WSL_DISTROS=Ubuntu-24.04` 指定发行版，或用 `CHATCRYSTAL_WSL=0` 关闭 WSL 扫描。
- 启动同步和手动同步会读取 WSL 与 VS Code Remote 会话；实时 watcher 只监听 Windows 本地目录，运行中 WSL 发行版里的变化会在下次启动或手动同步时被读入。
- 首次同步较大的 WSL 历史（例如 Codex 会话）会稍慢，因为 `\\wsl.localhost` 读取速度低于本地磁盘；同步在后台进行，对话可以边同步边浏览。
- 如只想按需同步，可设 `CHATCRYSTAL_AUTO_SYNC=0` 关闭启动/watcher 自动同步。

## CLI 命令

```bash
crystal status                          # 服务器状态与数据库统计
crystal import [--source claude-code]   # 扫描并导入对话
crystal search "关键词" [--limit 10]     # 语义搜索
crystal notes list [--tag 标签名]        # 浏览笔记
crystal notes get <id>                  # 查看笔记详情
crystal notes relations <id>            # 查看笔记关系
crystal tags                            # 列出标签
crystal summarize <id>                  # 摘要单条对话
crystal summarize --all                 # 批量摘要
crystal config get                      # 查看配置
crystal config set llm.provider openai  # 更新配置
crystal config test                     # 测试 LLM 连接
crystal serve -d                        # 后台启动服务器
crystal serve stop                      # 停止后台服务器
crystal mcp                             # 启动 MCP stdio 服务
```

桌面版不需要手动导入；`crystal import` 仍适用于 CLI/CI 工作流，以及把本地历史上传到云端实例。需要服务器的命令会在服务未运行时自动后台启动。输出会适配终端：交互式终端显示表格，被管道消费时输出 JSON。

## 配置

ChatCrystal 将运行时配置保存在当前数据目录的 `config.json` 中。

默认位置：

- CLI、MCP、npm 包、仓库 checkout 和 Electron：`~/.chatcrystal/data/config.json`
- 自定义数据目录：`<DATA_DIR>/config.json`

`.env` 是可选的。只有在本地开发需要覆盖 `PORT`、数据源路径或预置 Provider key 时才需要保留。

典型 `config.json`：

```json
{
  "llm": {
    "provider": "ollama",
    "baseURL": "http://localhost:11434",
    "model": "qwen2.5:7b",
    "apiKey": ""
  },
  "embedding": {
    "provider": "ollama",
    "baseURL": "http://localhost:11434",
    "model": "nomic-embed-text",
    "apiKey": ""
  },
  "enabledSources": [
    "claude-code", "codex", "cursor", "trae", "copilot",
    "gemini", "qwen", "opencode", "cline", "roo", "kilo",
    "copilot-cli", "continue", "dsh", "workbuddy", "antigravity", "droid", "goose",
    "pi", "omp", "raft", "cindy", "qoder", "qoder-cn", "codebuddy", "claude-desktop",
    "zcode", "hermes", "alma", "grok", "kimi", "minimax-code"
  ]
}
```

### 同步、解析与缓存

可选环境变量，用于调节后台同步管线：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `CHATCRYSTAL_AUTO_SYNC` | 开启 | 设为 `0` 关闭启动与 watcher 自动同步；手动同步和 `crystal import` 仍可用。 |
| `CHATCRYSTAL_PARSE_WORKERS` | `min(4, CPU-1)` | 解析 transcript 的 worker 线程数；`0` 表示在主线程解析。 |
| `CHATCRYSTAL_TRANSCRIPT_CACHE` | 开启 | 设为 `off` 禁用解析缓存。 |
| `CHATCRYSTAL_TRANSCRIPT_CACHE_DIR` | `<dataDir>/transcript-cache` | 缓存目录。 |
| `CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_MB` | `512` | 缓存大小上限，超出后从最旧条目开始清理。 |
| `CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_AGE_DAYS` | `30` | 缓存保留天数上限。 |
| `CHATCRYSTAL_WSL` / `CHATCRYSTAL_WSL_DISTROS` | 运行中的发行版 | WSL 扫描控制（见上文）。 |

### Provider 示例

可以通过 Settings 页面、`crystal config`、`config.json` 或 `.env` 覆盖设置。

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

# OrcaRouter
LLM_PROVIDER=orcarouter
LLM_API_KEY=sk-orca-...
LLM_MODEL=<model-id>

# OpenAI 兼容服务
LLM_PROVIDER=custom
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=your-key
LLM_MODEL=anthropic/claude-sonnet-4
```

OrcaRouter 是 OpenAI-compatible LLM Provider。ChatCrystal 已内置其 `https://api.orcarouter.ai/v1` Base URL，因此无需设置 `LLM_BASE_URL`。在 **Settings** 中填写 OrcaRouter API Key 后，即可获取可用模型并选择模型再保存。[获取 OrcaRouter API Key](https://www.orcarouter.ai/ref/ref_67516d927343232775e2)。

## LLM 与 Embedding 模型

LLM 和 Embedding 模型必须分别配置。语义搜索需要支持 `/v1/embeddings` 端点的模型。

| Provider | 常见 Embedding 模型 |
|---|---|
| Ollama | `nomic-embed-text`, `mxbai-embed-large` |
| OpenAI | `text-embedding-3-small`, `text-embedding-3-large` |
| Google | `text-embedding-004` |

Claude、GPT、Qwen 等大语言模型不是 Embedding 模型。

## 数据目录

所有数据都保存在当前数据目录（默认 `~/.chatcrystal/data`，可用 `DATA_DIR` 覆盖）：

| 路径 | 内容 |
|---|---|
| `chatcrystal.db` | WAL 模式的 SQLite 数据库。应用运行期间 `chatcrystal.db-wal` 和 `chatcrystal.db-shm` 也属于它；备份时请退出应用，或三个文件一起复制。 |
| `transcript-cache/` | 已解析 transcript 的 gzip JSON 快照，按来源、会话、解析器版本和文件元信息索引。可以安全删除，需要时会从原始 Agent 会话文件重新解析。 |
| `config.json` | Provider、启用的数据源和应用配置。 |
| `vectra-index/` | 语义搜索使用的本地向量索引（首次生成笔记后创建）。 |

transcript 缓存只是可选加速：它让后续读取、懒解析详情和中断同步的恢复更快，并会按上面的容量/时间上限在后台清理，不会替代原始 Agent 会话文件。

## 常见问题

### 语义搜索返回 500 "Not Found"

通常是 Embedding 模型配置错误。请将 `EMBEDDING_MODEL` 设置为 `nomic-embed-text` 这类专用 Embedding 模型，而不是 `qwen2.5` 或 `claude-haiku` 这类聊天模型。

### ChatCrystal 无法连接 Ollama

确认 Ollama 正在运行，并且模型已拉取：

```bash
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

### 导入时没有发现对话

检查 Settings 页面或 `config.json` 里的数据源路径。如果仍在使用 `.env` 覆盖，也要一起检查。

### 首次安装后引导窗口是空白

0.7.1 之前的打包版本可能打开空白引导页：页面无法从应用包内加载资源，按钮也会报 origin 错误。请升级到 0.7.1 或更新版本。源码/开发模式不受影响。

### 对话一直显示「索引中」

说明同步在该会话解析完成前被取消、中断或失败了。查看侧边栏的上次结果，然后点**重试**（或**开始同步**）；直接打开该对话也会按需补全。如果某个文件反复失败，可能是原始 Agent 会话文件格式异常，或正被写作中的 Agent 占用。

### 首次同步很慢或 CPU 占用高

首轮会解析全部历史，之后只处理新增或变化的文件。可以取消后先浏览已索引的对话，调低 `CHATCRYSTAL_PARSE_WORKERS`，或设 `CHATCRYSTAL_AUTO_SYNC=0` 改用手动同步。WSL 历史因通过 `\\wsl.localhost` 读取会更慢。

### 磁盘占用持续增长

主要是 transcript 缓存。它默认自动清理到 512 MB / 30 天；可以调低 `CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_MB` 或 `CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_AGE_DAYS`，或设 `CHATCRYSTAL_TRANSCRIPT_CACHE=off` 并在关闭应用后删除 `transcript-cache` 目录。SQLite 数据库会随导入消息和笔记增长；不需要的旧对话可以在 Conversations 页面删除。

### 知识图谱为空

需要先生成带 tag 的笔记。默认图谱基于笔记 tag 构建；如果仍然为空，请检查笔记是否有 tag，或调低图谱关联强度筛选。
