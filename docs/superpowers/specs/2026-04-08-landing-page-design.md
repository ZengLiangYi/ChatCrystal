# ChatCrystal Landing Page Design Spec

## Overview

为 ChatCrystal 创建一个独立的 landing page，部署在 GitHub Pages 上，用于向开发者展示产品价值、提高项目知名度，并为后续 Product Hunt / Hacker News 首发提供落地页。

## Goals

- **主要受众：** 已在使用 Claude Code / Cursor / Codex 的开发者（有直接痛点，转化路径短）
- **次要受众：** 对 AI 工具链感兴趣的广泛技术人群（通过愿景吸引）
- **核心目标：** 让访问者在 30 秒内理解产品价值并开始安装

## Technical Decisions

| 决策 | 选择 | 理由 |
|------|------|------|
| 框架 | Astro + `@astrojs/react` | 零 JS 默认 + React islands 按需水合，SEO 最优 |
| 动效 | Framer Motion + CSS scroll-driven animations | 够做 Linear/Raycast 级效果，无需 3D |
| 视频素材 | Remotion 预渲染 WebM/GIF | 复用 `promo/` 基础设施，效果可控，加载轻量 |
| i18n | 路由级 `/` (EN) + `/zh/` (中文) | Astro 内置支持，SEO 友好（独立 URL + hreflang） |
| 部署 | GitHub Pages + `@astrojs/github-pages` adapter | 免费、CDN、自定义域名、HTTPS |
| 项目位置 | Monorepo `site/` 目录 | 与主项目同仓库，版本同步，CI/CD 统一 |
| 在线 Demo | 第一版静态模拟，后续加真实交互 Demo | 先快速上线，控制复杂度 |

## Project Structure

```
site/
├── astro.config.mjs
├── package.json
├── src/
│   ├── layouts/Layout.astro       # 基础 HTML 布局，注入 meta/og/hreflang
│   ├── pages/
│   │   ├── index.astro            # 英文版（默认）
│   │   └── zh/index.astro         # 中文版
│   ├── components/
│   │   ├── Hero.tsx               # React island - Framer Motion 入场动画
│   │   ├── IntegrationStrip.astro # 纯静态
│   │   ├── HowItWorks.astro       # 纯静态 + CSS scroll animation
│   │   ├── FeatureBento.tsx       # React island - 视频自动播放控制
│   │   ├── LocalFirst.tsx         # React island - 架构图绘制动画
│   │   ├── CliShowcase.tsx        # React island - 终端打字动画
│   │   └── Footer.astro           # 纯静态
│   ├── i18n/
│   │   ├── en.json
│   │   └── zh.json
│   └── styles/
│       └── global.css
├── public/
│   ├── demos/                     # Remotion 预渲染的 WebM/GIF
│   ├── screenshots/               # 复用现有截图
│   └── og-image.png
```

**组件策略：**
- 纯静态内容用 `.astro` 组件（零 JS 输出）
- 需要动效/交互的用 `.tsx` React island + `client:visible` 懒加载

## Page Sections

### 1. Hero

**布局：** 左文案 + 右动画，大屏横排，移动端上下堆叠。

**内容：**
- 标签：`Open Source · Local First`
- 主标题：`Turn AI Conversations into Searchable Knowledge`
  - 中文：`将 AI 对话结晶为可搜索的知识`
- 副标题：一句话说明支持 Claude Code / Cursor / Codex，本地运行
- CTA 组：
  - 主按钮：`npm i -g chatcrystal`（点击复制 + 打勾反馈动效）
  - 次按钮：`Download Desktop App`（→ GitHub Releases）
  - GitHub stars badge（实时数字）

**动效：**
- 文案 Framer Motion 交错入场（stagger fade-up）
- 右侧 Remotion 预渲染视频自动播放（muted, loop, WebM）
- 安装命令复制后微交互反馈

**实现：** React island (`Hero.tsx`), `client:load`

### 2. Integration Strip（多源支持条）

**布局：** 水平居中一行。

**内容：**
- 引导文案：`Works with your favorite AI coding tools`
- 三个 logo 卡片横排：
  - Claude Code — "JSONL conversations"
  - Cursor — "Workspace history"
  - Codex CLI — "Session events"

**动效：** CSS scroll-driven animation, fade-up 进入视口。

**实现：** 纯 `.astro` 组件，零 JS。

### 3. How It Works（三步流程）

**布局：** 三列（移动端竖排），步骤间连线/箭头串联。

**内容：**
1. **Import** — 自动扫描本地 AI 对话记录
2. **Crystallize** — LLM 生成结构化笔记：标题、摘要、关键结论、代码片段、标签
3. **Search** — 语义搜索你的知识库，随时找回

**动效：** CSS scroll-driven, 三步依次 fade-in + slide-up，带延迟顺序感。

**实现：** 纯 `.astro` 组件，零 JS。

### 4. Feature Bento Grid

**布局：** 2×3 网格（移动端单列），卡片大小不等形成错落感。

**6 个卡片：**

| # | Feature | 视觉素材 |
|---|---------|----------|
| 1 | **语义搜索** — 自然语言搜索，不只是关键词匹配 | Remotion 动画：输入查询 → 结果高亮浮现 |
| 2 | **结构化笔记** — 自动提取标题、摘要、关键结论、代码片段 | 截图：笔记详情页 |
| 3 | **MCP 集成** — AI 工具直接查询你的知识库 | 终端动画：Claude Code 调用 MCP 搜索 |
| 4 | **智能标签** — 自动分类，按标签浏览 | 截图：标签云 + 筛选 |
| 5 | **CLI 工具链** — 一套命令管理全部知识 | Remotion 动画：终端命令流 |
| 6 | **Electron 桌面应用** — 托盘运行，后台自动导入 | 截图：桌面应用窗口 |

**动效：**
- Framer Motion `whileInView` 卡片交错入场
- 视频卡片 `<video>` 视口内自动播放，离开暂停（Intersection Observer）

**实现：** React island (`FeatureBento.tsx`), `client:visible`

### 5. Local First Trust Section（本地优先信任区）

**布局：** 左架构图 + 右信任点纵排。

**内容：**
- **数据不离开你的电脑** — SQLite 本地存储，无云端依赖
- **完全开源** — MIT License，代码透明可审计
- **你掌控一切** — 自选 LLM 提供商，支持 Ollama 本地模型

**动效：** 架构图 Framer Motion 逐步绘制（节点依次出现 + 连线动画）。

**实现：** React island (`LocalFirst.tsx`), `client:visible`

### 6. CLI Showcase

**布局：** 全宽深色终端窗口样式。

**内容展示 3-4 条核心命令：**
- `crystal import`
- `crystal search "如何处理 JWT"`
- `crystal notes list --tag auth`

**动效：** Remotion 预渲染终端动画（打字机逐字输入 + 彩色输出逐行显现 + 光标闪烁），与其他 Remotion 素材统一制作流程。

**实现：** React island (`CliShowcase.tsx`), `client:visible`

### 7. Footer

**布局：** 简洁三列：
- 左：ChatCrystal logo + tagline
- 中：链接（GitHub / npm / Docs / Releases）
- 右：语言切换（EN / 中文）

**实现：** 纯 `.astro` 组件，零 JS。

## SEO Strategy

- 每个语言版本独立 URL，`<link rel="alternate" hreflang="...">` 互指
- 完整 meta tags：title, description, og:title, og:description, og:image, twitter:card
- `sitemap.xml` + `robots.txt` 自动生成（Astro 插件）
- 静态 HTML 输出，搜索引擎爬虫零障碍
- `og-image.png` 预制，包含产品截图 + logo + tagline

## Remotion Integration

复用 `promo/` 目录的 Remotion 基础设施：
- 为 landing page 新增渲染 compositions（Hero 动画、Feature 微动效、CLI 演示）
- 渲染输出为 WebM（Chrome/Firefox/Edge）+ MP4 fallback（Safari）
- 产物放入 `site/public/demos/`
- 构建流程：`promo/` 渲染 → 产物复制到 `site/public/demos/` → Astro 构建

## Deployment

- GitHub Pages，通过 GitHub Actions 自动部署
- 触发条件：`site/` 目录文件变更 push 到 main
- 构建步骤：`cd site && npm install && npm run build`
- 输出目录：`site/dist/`
- 后续可绑定自定义域名

## Future Enhancements（不在本次范围）

- 真实交互式在线 Demo（需要后端，第二阶段）
- Stats 统计卡片分享功能 + 落地展示页
- 博客/更新日志板块
