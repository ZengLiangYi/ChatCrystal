import type { Translations } from './en';

export const zh: Translations = {
  meta: {
    title: 'ChatCrystal — 将 AI 对话提炼为你的知识库',
    description: '开源本地优先工具，将你的 AI 编程对话（Claude Code、Cursor、Codex CLI、Trae、GitHub Copilot）提炼为结构化、可搜索的知识库。',
  },
  nav: {
    features: '功能',
    howItWorks: '原理',
    cli: '命令行',
    github: 'GitHub',
  },
  hero: {
    badge: '开源 · 本地优先',
    title: '将 AI 对话提炼为你的知识库',
    subtitle: '导入你常用的 AI 编程工具的对话记录，自动生成结构化笔记并支持语义搜索。所有数据留在本地。',
    installCmd: 'npm i -g chatcrystal',
    copied: '已复制！',
    downloadDesktop: '下载桌面应用',
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
    heading: '工作原理',
    steps: [
      { title: '导入', desc: '自动扫描本地 AI 对话记录' },
      { title: '提炼', desc: '由 LLM 生成结构化笔记：标题、摘要、关键结论、代码片段与标签' },
      { title: '搜索', desc: '语义搜索知识库，随时找回所需内容' },
    ],
  },
  features: {
    heading: '一站式知识管理',
    items: [
      { title: '语义搜索', desc: '用自然语言搜索，不止于关键词匹配' },
      { title: '结构化笔记', desc: '自动提取标题、摘要、关键结论与代码片段' },
      { title: 'MCP 集成', desc: '让 AI 工具直接查询你的知识库' },
      { title: '智能标签', desc: '自动分类，按标签快速浏览' },
      { title: '命令行工具', desc: '一套命令管理所有知识' },
      { title: '桌面应用', desc: '常驻托盘，后台自动导入' },
    ],
  },
  localFirst: {
    heading: '数据始终留在本地',
    yourMachine: '你的电脑',
    points: [
      { title: '数据不出本机', desc: 'SQLite 本地存储，无需云端' },
      { title: '完全开源', desc: 'MIT 协议，代码透明可审计' },
      { title: '自主可控', desc: '自选 LLM 服务商，支持 Ollama 全本地运行' },
    ],
  },
  cli: {
    heading: '强大的命令行',
  },
  footer: {
    tagline: '提炼你的 AI 知识',
    github: 'GitHub',
    npm: 'npm',
    docs: '文档',
    releases: '版本发布',
  },
};
