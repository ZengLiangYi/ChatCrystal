import type { Translations } from './en';

export const zh: Translations = {
  meta: {
    title: 'ChatCrystal — 将 AI 对话提炼为你的知识库',
    description: '开源本地优先 AI PKM / 个人知识管理工具，将 Claude Code、Cursor、Codex CLI、Trae、GitHub Copilot 对话提炼为可搜索笔记、标签图谱和 MCP 记忆。',
    keywords: 'AI PKM, 个人知识管理, personal knowledge management, personal knowledge base, 本地优先, 语义搜索, MCP, Claude Code, Cursor, Codex CLI, AI memory',
  },
  nav: {
    features: '功能',
    howItWorks: '原理',
    cli: '命令行',
    github: 'GitHub',
  },
  hero: {
    badge: '0.5.2 · 晨岚界面大更新',
    title: 'ChatCrystal',
    subtitle: '一个安静的本地知识工作台，把 AI 编程对话沉淀成笔记、标签图谱、Markdown 备份，并回流到下一次 Agent 协作。',
    installCmd: 'npm i -g chatcrystal',
    copied: '已复制！',
    downloadDesktop: '下载桌面应用',
    starOnGitHub: '在 GitHub 上 Star',
    highlights: [
      { value: '5', label: 'AI 编程来源' },
      { value: '本地', label: 'SQLite + 向量索引' },
      { value: 'MCP', label: '让 Agent 召回知识' },
    ],
  },
  integrations: {
    heading: '支持你常用的 AI 编程工具',
    claudeCode: { name: 'Claude Code', desc: 'JSONL 对话记录' },
    cursor: { name: 'Cursor', desc: '工作区历史' },
    codex: { name: 'Codex CLI', desc: '会话事件' },
    trae: { name: 'Trae', desc: 'Agent 任务记录' },
    copilot: { name: 'GitHub Copilot', desc: '聊天会话' },
  },
  howItWorks: {
    heading: '从对话历史到可复用知识',
    steps: [
      { title: '导入', desc: '扫描 Claude Code、Cursor、Codex CLI、Trae 与 Copilot 的本地历史。' },
      { title: '提炼', desc: '由 LLM 抽取摘要、决策、代码片段、来源信息与标签。' },
      { title: '探索', desc: '语义搜索笔记，并在标签知识图谱里查看知识点关系。' },
      { title: '回流', desc: '导出 Markdown，或通过 MCP 把任务记忆带回 Agent 工作流。' },
    ],
  },
  features: {
    eyebrow: '0.5.x 更新重点',
    heading: '为认真召回而重做的明亮工作台',
    items: [
      { title: '晨岚界面', desc: '浅色桌面工作台、温润纸面层次、紧凑控件和 shadcn/ui 组件全面统一。' },
      { title: '标签知识图谱', desc: '标签成为知识点节点，支持邻域高亮、详情面板与项目上下文。' },
      { title: '更准的语义搜索', desc: '融合向量与关键词信号，过滤弱相关结果，减少“看起来像但不相关”。' },
      { title: 'Markdown 导出', desc: '单篇笔记可导出干净 Markdown，包含本地化标题和最小 frontmatter。' },
      { title: 'Agent 记忆回路', desc: 'MCP 工具可以从同一个本地知识库召回和写入可复用任务记忆。' },
      { title: '桌面与云端控制', desc: '托盘应用、手动更新检查、访问令牌和个人云部署都进入同一套体验。' },
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
      { command: 'crystal import --source codex', note: '扫描本地会话' },
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
  },
};
