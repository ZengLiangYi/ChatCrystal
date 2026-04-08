# Landing Page Remotion Animations Design Spec

## Overview

为 ChatCrystal landing page 制作 5 个 Remotion 预渲染动画，嵌入 `site/public/demos/` 作为各版块的视觉素材。复用 `promo/` 现有基础设施（常量、工具函数、TerminalWindow 组件）。

## Technical Decisions

| 决策 | 选择 | 理由 |
|------|------|------|
| 视觉风格 | 统一 Variant B（macOS 窗口边框） | 精致，适合 landing page |
| 分辨率 | 800x450（16:9） | 与现有 promo 一致，匹配 landing page 的 `aspect-video` 容器 |
| 帧率 | 30 FPS | 与现有 promo 一致 |
| 输出格式 | WebM (VP9) + MP4 (H.264) fallback | WebM 体积小适合 web，MP4 兼容 Safari |
| 项目位置 | `promo/src/landing/` 子目录 | 与现有 promo scenes 隔离，共享工具函数 |

## Shared Resources (from existing promo/)

- `constants.ts` — BRAND, ANSI, SOURCE_COLORS, TYPEWRITER config
- `utils/typewriter.ts` — `getTypedText()`, `Cursor` component
- `utils/terminal.ts` — `TerminalWindow` (Variant B), `getSpinnerChar()`
- `public/logo.png` — ChatCrystal logo

## Compositions

### 1. LandingHero — `hero.webm`（10 秒 / 300 帧）

**叙事线：** AI 对话 → ChatCrystal 导入 → 结晶成结构化笔记

**时间线：**

| 帧范围 | 秒 | 画面 |
|--------|-----|------|
| 0-60 | 0-2s | macOS 窗口内，模拟 Claude Code 对话记录（几行 user/assistant 来回），快速打字机滚动 |
| 60-90 | 2-3s | 右下角弹出 `crystal import` 进度提示，spinner 转动 |
| 90-150 | 3-5s | 对话内容渐隐 dissolve，中央出现 ChatCrystal logo + "Crystallizing..." |
| 150-270 | 5-9s | Logo 缩小移到左上，右侧滑入结构化笔记卡片：标题、摘要逐行出现、3 个 tag badge 弹入、代码片段高亮块淡入 |
| 270-300 | 9-10s | 短暂停留，fade out |

**视觉要素：**
- Variant B 窗口边框
- 对话区分：user 文字 white，assistant 文字 lavender
- 笔记卡片：rounded border + 半透明 deep-purple 背景
- Tag badges 用 source colors（claude-code orange, codex green, cursor blue）
- 代码片段：terminal-bg 背景 + ANSI 语法高亮

### 2. LandingFeatureSearch — `feature-search.webm`（5 秒 / 150 帧）

**叙事线：** 输入自然语言查询 → 搜索结果带相关度分数浮现

**时间线：**

| 帧范围 | 秒 | 画面 |
|--------|-----|------|
| 0-45 | 0-1.5s | 顶部搜索栏，打字机输入 `How to handle JWT refresh tokens` |
| 45-60 | 1.5-2s | 搜索栏下方 loading shimmer 效果 |
| 60-135 | 2-4.5s | 三条搜索结果卡片依次 slide-up：标题、摘要片段（关键词 lavender 高亮）、相关度分数、来源标签 |
| 135-150 | 4.5-5s | 停留，fade out |

**视觉要素：**
- 搜索栏：深色输入框 + 放大镜 SVG 图标（非 emoji）
- 结果卡片：半透明背景，关键词用 lavender 高亮
- 相关度分数：绿色渐变（高分更亮，如 0.94 / 0.87 / 0.72）
- 来源标签用对应 source color

### 3. LandingFeatureMcp — `feature-mcp.webm`（5 秒 / 150 帧）

**叙事线：** Claude Code 中调用 MCP 工具查询知识库 → 返回结果

**时间线：**

| 帧范围 | 秒 | 画面 |
|--------|-----|------|
| 0-45 | 0-1.5s | user 消息打字机输入：`How did we implement rate limiting?` |
| 45-75 | 1.5-2.5s | tool call 块出现：`search_knowledge("rate limiting")` + spinner |
| 75-120 | 2.5-4s | spinner → ✓，结果展开：笔记摘要 + 代码片段（middleware 代码，语法高亮） |
| 120-135 | 4-4.5s | assistant 总结文字淡入 |
| 135-150 | 4.5-5s | 停留，fade out |

**视觉要素：**
- tool call 块：cobalt-blue 边框，模拟 Claude Code tool use 风格
- 代码片段：terminal-bg 背景 + ANSI 颜色语法高亮
- assistant 文字：lavender

### 4. LandingFeatureCli — `feature-cli.webm`（6 秒 / 180 帧）

**叙事线：** 快速展示 3 条 CLI 命令的输入输出

**时间线：**

| 帧范围 | 秒 | 画面 |
|--------|-----|------|
| 0-54 | 0-1.8s | `$ crystal status` → 输出：Server running, 258 conversations, 142 notes, 3 sources |
| 54-108 | 1.8-3.6s | `$ crystal tags` → tag 列表带计数，彩色排列 |
| 108-165 | 3.6-5.5s | `$ crystal summarize --all` → 进度条动画 → `✓ 15 notes generated` |
| 165-180 | 5.5-6s | 停留，fade out |

**视觉要素：**
- Variant B 窗口
- `$` 前缀：green
- 数字/计数：cyan 高亮
- 进度条：purple 填充色
- `✓`：green

### 5. LandingCliShowcase — `cli-showcase.webm`（12 秒 / 360 帧）

**叙事线：** 完整核心工作流：导入 → 搜索 → 查看笔记

**时间线：**

| 帧范围 | 秒 | 画面 |
|--------|-----|------|
| 0-90 | 0-3s | `$ crystal import` → 三个来源扫描（Claude Code / Codex / Cursor，spinner → ✓ 各一行）→ `Imported 258 conversations.` |
| 90-105 | 3-3.5s | 空行间隔 |
| 105-195 | 3.5-6.5s | `$ crystal search "JWT authentication"` → 3 条结果逐行出现（序号、标题、分数、来源 tag） |
| 195-210 | 6.5-7s | 空行间隔 |
| 210-315 | 7-10.5s | `$ crystal notes get abc123` → 完整笔记：标题、摘要（2 行）、关键结论（2 条 bullet）、tags 列表 |
| 315-360 | 10.5-12s | 停留，fade out |

**视觉要素：**
- Variant B 窗口
- 导入复用 Scene3Import 的来源扫描模式（spinner + source colors）
- 搜索结果：序号 cyan，标题 white，分数 green
- 笔记结构：标题 bright white，摘要 dim white，结论 lavender，tags 用各自颜色

## Project Structure

```
promo/src/
├── landing/
│   ├── LandingHero.tsx
│   ├── LandingFeatureSearch.tsx
│   ├── LandingFeatureMcp.tsx
│   ├── LandingFeatureCli.tsx
│   └── LandingCliShowcase.tsx
├── scenes/          # existing promo scenes (unchanged)
├── utils/           # shared typewriter, terminal (unchanged)
└── Root.tsx         # add landing compositions in a new Folder
```

## Root.tsx Changes

在 `Root.tsx` 中新增一个 `Folder name="Landing"` 包含 5 个 Composition：

```
Landing/
  LandingHero           — 300 frames (10s)
  LandingFeatureSearch  — 150 frames (5s)
  LandingFeatureMcp     — 150 frames (5s)
  LandingFeatureCli     — 180 frames (6s)
  LandingCliShowcase    — 360 frames (12s)
```

## Render Pipeline

新建 `promo/render-landing.sh`：
1. 渲染每个 composition 为 WebM (VP9) + MP4 (H.264)
2. 输出到 `site/public/demos/`
3. 文件名：`hero.webm`, `hero.mp4`, `feature-search.webm`, `feature-search.mp4`, `feature-mcp.webm`, `feature-mcp.mp4`, `feature-cli.webm`, `feature-cli.mp4`, `cli-showcase.webm`, `cli-showcase.mp4`

## Not In Scope

- Remotion Studio 实时预览 UI 优化
- 音频/配乐
- 多语言动画内容（动画中的示例文本统一用英文，因为代码和命令本身是英文的）
