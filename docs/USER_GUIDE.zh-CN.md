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
npm install
npm run dev
```

开发模式会启动 API 服务 http://localhost:3721 和 Vite 客户端 http://localhost:13721。

### 桌面应用

```bash
npm run dev:electron
npm run build:electron
```

安装包会生成到 `release/`。桌面应用与 CLI、MCP server 使用同一个默认数据目录：`~/.chatcrystal/data`。

## 使用流程

1. 点击 **Import**，扫描 Claude Code、Codex CLI、Cursor、Trae、GitHub Copilot 对话。
2. 在 **Conversations** 页面浏览原始对话。
3. 点击 **Summarize** 或批量摘要，生成结构化笔记。
4. 在 **Search** 页面搜索知识；需要更完整上下文时开启关联笔记扩展。
5. 打开图谱视图，浏览笔记之间的关系。
6. 在 **Settings** 页面切换 LLM 和 Embedding Provider。

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

需要服务器的命令会在服务未运行时自动后台启动。输出会适配终端：交互式终端显示表格，被管道消费时输出 JSON。

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
  "enabledSources": ["claude-code", "codex", "cursor", "trae", "copilot"]
}
```

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

# OpenAI 兼容服务
LLM_PROVIDER=custom
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=your-key
LLM_MODEL=anthropic/claude-sonnet-4
```

## LLM 与 Embedding 模型

LLM 和 Embedding 模型必须分别配置。语义搜索需要支持 `/v1/embeddings` 端点的模型。

| Provider | 常见 Embedding 模型 |
|---|---|
| Ollama | `nomic-embed-text`, `mxbai-embed-large` |
| OpenAI | `text-embedding-3-small`, `text-embedding-3-large` |
| Google | `text-embedding-004` |

Claude、GPT、Qwen 等大语言模型不是 Embedding 模型。

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

### 知识图谱为空

需要先生成笔记。然后在笔记详情页触发关系发现，或通过 API 执行批量关系发现。

