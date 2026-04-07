# V2EX — 创造者

**标题：** ChatCrystal — 把你的 AI 对话变成可搜索的知识库

---

最近一年用 Claude Code 做了很多项目，积累了几百个对话。但每次想找之前解决过的一个问题，都要在 `~/.claude/projects/` 里翻一堆 JSONL 文件，基本找不到。

于是写了 ChatCrystal，专门解决这个问题。

**主要功能：**

- 自动导入 Claude Code、Codex CLI、Cursor 的对话记录
- 用 LLM 对每个对话生成结构化笔记：标题、摘要、关键结论、代码片段、标签
- 向量语义搜索，按含义检索，不依赖关键词
- 知识图谱：让 LLM 发现笔记之间的关联
- MCP Server 集成：Claude Code 可以在对话中直接调用你的知识库

**技术栈：**

- 后端：Fastify + sql.js（WASM SQLite，无原生依赖）
- 前端：React + TanStack Query + Tailwind CSS v4
- 向量索引：vectra（本地文件，无需额外服务）
- LLM 接入：Vercel AI SDK，支持 Ollama / OpenAI / Anthropic / Google / 自定义端点
- 桌面端：Electron，支持系统托盘

**完全本地运行，数据不出本机。** 配合 Ollama 可以做到 0 外部依赖、0 API 费用。

**安装：**

```bash
npm install -g chatcrystal
crystal serve -d
crystal import
crystal search "上个月修的那个 webpack 问题"
```

目前是独立开发，还比较早期。欢迎大家试用，有问题或建议直接回复或提 issue。

GitHub：https://github.com/ZengLiangYi/ChatCrystal
