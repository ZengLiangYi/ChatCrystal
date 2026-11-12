import type { Translations } from './en';

export const zh: Translations = {
  meta: {
    title: 'ChatCrystal — 将 AI 对话提炼为你的知识库',
    description: '开源本地优先 AI PKM / 个人知识管理工具，把 32 个 AI 编程 Agent（Claude Code、Claude Desktop、Codex CLI、Cursor、Copilot、Gemini CLI、OpenCode、Pi、Kimi Code 等）的对话提炼为可搜索笔记、标签图谱和 MCP 记忆，并支持 Windows 上的 WSL 会话。',
    keywords: 'AI PKM, 个人知识管理, personal knowledge management, personal knowledge base, 本地优先, 语义搜索, MCP, Claude Code, Cursor, Codex CLI, Gemini CLI, AI memory',
  },
  nav: {
    features: '功能',
    howItWorks: '原理',
    cli: '命令行',
    github: 'GitHub',
  },
  hero: {
    badge: '0.7.0 · 无感导入',
    title: 'ChatCrystal',
    subtitle: '一个安静的本地知识工作台，自动同步 AI 编程对话，沉淀成笔记、标签图谱、Markdown 备份，并回流到下一次 Agent 协作。',
    installCmd: 'npm i -g chatcrystal',
    copied: '已复制！',
    downloadDesktop: '下载桌面应用',
    starOnGitHub: '在 GitHub 上 Star',
    highlights: [
      { value: '32', label: 'AI Agent Harness' },
      { value: '本地', label: '原生 SQLite · WAL' },
      { value: 'MCP', label: '让 Agent 召回知识' },
    ],
  },
  integrations: {
    heading: '支持你正在使用的 AI Agent',
    subheading: '所有对话都在本地导入 —— 来自 Windows、WSL 发行版与 VS Code Remote 工作区。',
    loopAriaA: 'AI 编程 Agent 与 IDE 助手',
    loopAriaB: '更多 AI 编程 Agent、CLI 与桌面 Harness',
    caption: '32 个 Agent Harness · 本地、WSL 与 VS Code Remote 历史',
  },
  howItWorks: {
    heading: '从对话历史到可复用知识',
    steps: [
      { title: '同步', desc: '启动与文件变化时自动同步 Claude Code、Codex CLI、Cursor、Copilot、Gemini CLI 等 32 个 Agent 的历史，无需手动导入；扫描完成列表立即出现。' },
      { title: '提炼', desc: '由 LLM 抽取摘要、决策、代码片段、来源信息与标签。' },
      { title: '探索', desc: '语义搜索笔记，并在标签知识图谱里查看知识点关系。' },
      { title: '回流', desc: '导出 Markdown，或通过 MCP 把任务记忆带回 Agent 工作流。' },
    ],
  },
  features: {
    eyebrow: '0.7.0 更新重点',
    heading: '无感导入与更快的本地引擎',
    items: [
      { title: '无感后台同步', desc: '启动同步与文件监听两路并行，Agent 历史自动保持最新——没有导入按钮，也不用等全量扫描。' },
      { title: '索引优先，列表即现', desc: '扫描一结束对话行立即出现，正文在后台解析；解析中的会话也可以直接打开，按需补全。' },
      { title: '标签知识图谱', desc: '标签成为知识点节点，支持邻域高亮、详情面板与项目上下文。' },
      { title: '更准的语义搜索', desc: '融合向量与关键词信号，过滤弱相关结果，减少“看起来像但不相关”。' },
      { title: 'Markdown 导出', desc: '单篇笔记可导出干净 Markdown，包含本地化标题和最小 frontmatter。' },
      { title: 'Agent 记忆回路', desc: 'MCP 工具可以从同一个本地知识库召回和写入可复用任务记忆。' },
      { title: '可靠的桌面初始化', desc: '首次启动的引导页可正确连接本地核心或云端实例，打包版也能正常加载设置页面。' },
    ],
  },
  localFirst: {
    heading: '数据始终留在本地',
    yourMachine: '你的电脑',
    points: [
      { title: '数据不出本机', desc: 'SQLite 本地存储，无需云端' },
      { title: '完全开源', desc: 'Apache-2.0 协议，代码透明可审计' },
      { title: '自主可控', desc: '自选 LLM 服务商，支持 Ollama 全本地运行' },
    ],
  },
  cli: {
    eyebrow: 'CLI + MCP',
    heading: '让知识流留在终端旁边',
    subheading: '同一个本地服务同时支撑桌面应用、REST API、CLI 和 MCP 记忆工具。',
    commands: [
      { command: 'crystal import --source codex', note: '手动 / CI 导入' },
      { command: 'crystal search "JWT 缓存策略"', note: '语义召回' },
      { command: 'crystal mcp', note: '提供 Agent 工具' },
    ],
  },
  footer: {
    tagline: '提炼你的 AI 知识',
    github: 'GitHub',
    npm: 'npm',
    docs: '文档',
    releases: '版本发布',
    blog: '作者博客',
  },
};
