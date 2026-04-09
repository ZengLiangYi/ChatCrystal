import type { Translations } from './en';

export const zh: Translations = {
  meta: {
    title: 'ChatCrystal — 将 AI 对话结晶为可搜索的知识',
    description: '开源本地优先工具，将你的 AI 编程对话（Claude Code、Cursor、Codex）结晶为结构化、可语义搜索的知识库。',
  },
  nav: {
    features: '功能',
    howItWorks: '原理',
    cli: '命令行',
    github: 'GitHub',
  },
  hero: {
    badge: '开源 · 本地优先',
    title: '将 AI 对话结晶为可搜索的知识',
    subtitle: '导入 Claude Code、Cursor、Codex CLI 的对话记录，AI 自动生成结构化笔记并提供语义搜索。一切数据留在本地。',
    installCmd: 'npm i -g chatcrystal',
    copied: '已复制！',
    downloadDesktop: '下载桌面应用',
  },
  integrations: {
    heading: '支持你常用的 AI 编程工具',
    claudeCode: { name: 'Claude Code', desc: 'JSONL 对话记录' },
    cursor: { name: 'Cursor', desc: '工作区历史' },
    codex: { name: 'Codex CLI', desc: '会话事件' },
  },
  howItWorks: {
    heading: '工作原理',
    steps: [
      { title: '导入', desc: '自动扫描本地 AI 对话记录' },
      { title: '结晶', desc: 'LLM 生成结构化笔记：标题、摘要、关键结论、代码片段、标签' },
      { title: '搜索', desc: '语义搜索你的知识库，随时找回' },
    ],
  },
  features: {
    heading: '一站式知识管理',
    items: [
      { title: '语义搜索', desc: '用自然语言搜索，不只是关键词匹配' },
      { title: '结构化笔记', desc: '自动提取标题、摘要、关键结论、代码片段' },
      { title: 'MCP 集成', desc: 'AI 工具直接查询你的知识库' },
      { title: '智能标签', desc: '自动分类，按标签浏览' },
      { title: 'CLI 工具链', desc: '一套命令管理全部知识' },
      { title: '桌面应用', desc: '托盘运行，后台自动导入' },
    ],
  },
  localFirst: {
    heading: '你的数据留在本地',
    yourMachine: '你的电脑',
    points: [
      { title: '数据不离开你的电脑', desc: 'SQLite 本地存储，无云端依赖' },
      { title: '完全开源', desc: 'MIT License，代码透明可审计' },
      { title: '你掌控一切', desc: '自选 LLM 提供商，支持 Ollama 本地模型' },
    ],
  },
  cli: {
    heading: '强大的命令行工具',
  },
  footer: {
    tagline: '结晶你的 AI 知识',
    github: 'GitHub',
    npm: 'npm',
    docs: '文档',
    releases: '版本发布',
  },
};
