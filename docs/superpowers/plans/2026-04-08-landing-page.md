# ChatCrystal Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bilingual (EN/ZH) landing page for ChatCrystal using Astro + React islands, deployed to GitHub Pages.

**Architecture:** Astro static site in `site/` directory of the monorepo. Pure `.astro` components for static sections (zero JS), React islands with Framer Motion for animated sections (`client:visible` lazy hydration). Remotion pre-rendered WebM videos from `promo/` for product demos. Route-level i18n: `/` (EN) and `/zh/` (ZH).

**Tech Stack:** Astro 5, @astrojs/react, @astrojs/sitemap, @astrojs/tailwind (Tailwind CSS v4), Framer Motion 12, React 19, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-08-landing-page-design.md`

**Existing assets:**
- Screenshots: `docs/screenshots/en/{conversations,notes,search,graph}.png`, `docs/screenshots/zh-CN/` (same names)
- Icon: `electron/icon.png` (512×512)
- Brand colors: `promo/src/constants.ts` — `BRAND`, `SOURCE_COLORS`, `ANSI`
- Remotion infrastructure: `promo/` with 7 scenes, 2 composition variants

---

## File Structure

```
site/
├── package.json
├── astro.config.mjs
├── tsconfig.json
├── src/
│   ├── layouts/
│   │   └── Layout.astro            # HTML shell: meta, og, hreflang, font, global CSS
│   ├── pages/
│   │   ├── index.astro             # EN page — assembles all sections
│   │   └── zh/
│   │       └── index.astro         # ZH page — same structure, lang="zh"
│   ├── components/
│   │   ├── Hero.tsx                # React island (client:load)
│   │   ├── IntegrationStrip.astro  # Pure static
│   │   ├── HowItWorks.astro        # Pure static + CSS scroll animation
│   │   ├── FeatureBento.tsx        # React island (client:visible)
│   │   ├── LocalFirst.tsx          # React island (client:visible)
│   │   ├── CliShowcase.tsx         # React island (client:visible)
│   │   └── Footer.astro            # Pure static
│   ├── i18n/
│   │   ├── en.ts                   # English strings
│   │   ├── zh.ts                   # Chinese strings
│   │   └── index.ts                # getTranslations(lang) helper
│   └── styles/
│       └── global.css              # Tailwind imports + CSS custom properties + scroll animations
├── public/
│   ├── favicon.svg
│   ├── og-image.png
│   ├── logo.png                    # Copied from electron/icon.png
│   ├── demos/                      # Remotion WebM outputs (added later, gitkeep for now)
│   │   └── .gitkeep
│   └── screenshots/
│       ├── en/                     # Copied from docs/screenshots/en/
│       └── zh/                     # Copied from docs/screenshots/zh-CN/
```

---

### Task 1: Astro Project Scaffolding

**Files:**
- Create: `site/package.json`
- Create: `site/astro.config.mjs`
- Create: `site/tsconfig.json`

- [ ] **Step 1: Create `site/package.json`**

```json
{
  "name": "chatcrystal-site",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd site
npm install astro @astrojs/react @astrojs/sitemap @astrojs/tailwind
npm install react react-dom framer-motion
npm install -D typescript @types/react @types/react-dom tailwindcss @tailwindcss/vite
```

- [ ] **Step 3: Create `site/astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://zengliangyi.github.io',
  base: '/ChatCrystal',
  output: 'static',
  integrations: [
    react(),
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: { en: 'en', zh: 'zh-CN' },
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
```

- [ ] **Step 4: Create `site/tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

- [ ] **Step 5: Verify Astro builds**

```bash
cd site && npx astro check
```

Expected: no errors (may warn about missing pages, that's fine).

- [ ] **Step 6: Commit**

```bash
git add site/package.json site/package-lock.json site/astro.config.mjs site/tsconfig.json
git commit -m "feat(site): scaffold Astro project with React + Tailwind + i18n"
```

---

### Task 2: Global Styles + Brand Tokens

**Files:**
- Create: `site/src/styles/global.css`

- [ ] **Step 1: Create `site/src/styles/global.css`**

Reuse brand colors from `promo/src/constants.ts`. Define CSS custom properties and Tailwind imports.

```css
@import "tailwindcss";

:root {
  /* Brand palette — synced with promo/src/constants.ts BRAND */
  --color-bg: #0A0C10;
  --color-terminal-bg: #0D0F14;
  --color-deep-purple: #4A2D7A;
  --color-purple: #7B4DAA;
  --color-lavender: #B488D9;
  --color-cobalt-blue: #3B6DC6;
  --color-blue: #5B8DEF;
  --color-white: #E8E9ED;
  --color-dim-white: #8B8FA3;
  --color-muted: #5C5F6E;

  /* Source colors */
  --color-claude-code: #E8A838;
  --color-codex: #4ADE80;
  --color-cursor: #5B8DEF;
}

html {
  scroll-behavior: smooth;
}

body {
  background-color: var(--color-bg);
  color: var(--color-white);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}

/* Scroll-driven fade-up animation */
@keyframes fade-up {
  from {
    opacity: 0;
    transform: translateY(2rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-on-scroll {
  animation: fade-up linear both;
  animation-timeline: view();
  animation-range: entry 0% entry 30%;
}

/* Staggered children — use on parent, children get sequential delay */
.stagger-children > * {
  animation: fade-up linear both;
  animation-timeline: view();
  animation-range: entry 0% entry 35%;
}
.stagger-children > *:nth-child(1) { animation-delay: 0ms; }
.stagger-children > *:nth-child(2) { animation-delay: 100ms; }
.stagger-children > *:nth-child(3) { animation-delay: 200ms; }
.stagger-children > *:nth-child(4) { animation-delay: 300ms; }
.stagger-children > *:nth-child(5) { animation-delay: 400ms; }
.stagger-children > *:nth-child(6) { animation-delay: 500ms; }

/* Code/terminal monospace */
.font-mono {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
}
```

- [ ] **Step 2: Commit**

```bash
git add site/src/styles/global.css
git commit -m "feat(site): add global styles with brand tokens and scroll animations"
```

---

### Task 3: i18n System

**Files:**
- Create: `site/src/i18n/en.ts`
- Create: `site/src/i18n/zh.ts`
- Create: `site/src/i18n/index.ts`

- [ ] **Step 1: Create `site/src/i18n/en.ts`**

```ts
export const en = {
  meta: {
    title: 'ChatCrystal — Turn AI Conversations into Searchable Knowledge',
    description: 'Open-source, local-first tool that crystallizes your AI coding conversations (Claude Code, Cursor, Codex) into structured, searchable knowledge.',
  },
  hero: {
    badge: 'Open Source · Local First',
    title: 'Turn AI Conversations into Searchable Knowledge',
    subtitle: 'Import conversations from Claude Code, Cursor, and Codex CLI. AI crystallizes them into structured notes with semantic search. Everything stays on your machine.',
    installCmd: 'npm i -g chatcrystal',
    copied: 'Copied!',
    downloadDesktop: 'Download Desktop App',
  },
  integrations: {
    heading: 'Works with your favorite AI coding tools',
    claudeCode: { name: 'Claude Code', desc: 'JSONL conversations' },
    cursor: { name: 'Cursor', desc: 'Workspace history' },
    codex: { name: 'Codex CLI', desc: 'Session events' },
  },
  howItWorks: {
    heading: 'How It Works',
    steps: [
      { title: 'Import', desc: 'Auto-scan your local AI conversation history' },
      { title: 'Crystallize', desc: 'LLM generates structured notes: title, summary, key conclusions, code snippets, tags' },
      { title: 'Search', desc: 'Semantic search your knowledge base — find anything, anytime' },
    ],
  },
  features: {
    heading: 'Everything you need',
    items: [
      { title: 'Semantic Search', desc: 'Search with natural language, not just keywords' },
      { title: 'Structured Notes', desc: 'Auto-extract titles, summaries, key conclusions, and code snippets' },
      { title: 'MCP Integration', desc: 'AI tools query your knowledge base directly' },
      { title: 'Smart Tags', desc: 'Auto-categorize and browse by tags' },
      { title: 'CLI Toolkit', desc: 'One set of commands to manage all your knowledge' },
      { title: 'Desktop App', desc: 'Runs in system tray, auto-imports in the background' },
    ],
  },
  localFirst: {
    heading: 'Your data stays local',
    points: [
      { title: 'Never leaves your machine', desc: 'SQLite local storage, zero cloud dependency' },
      { title: 'Fully open source', desc: 'MIT License, transparent and auditable' },
      { title: 'You\'re in control', desc: 'Choose your LLM provider — supports Ollama for fully local AI' },
    ],
  },
  cli: {
    heading: 'Powerful CLI',
  },
  footer: {
    tagline: 'Crystallize your AI knowledge',
    github: 'GitHub',
    npm: 'npm',
    docs: 'Docs',
    releases: 'Releases',
  },
} as const;

export type Translations = typeof en;
```

- [ ] **Step 2: Create `site/src/i18n/zh.ts`**

```ts
import type { Translations } from './en';

export const zh: Translations = {
  meta: {
    title: 'ChatCrystal — 将 AI 对话结晶为可搜索的知识',
    description: '开源本地优先工具，将你的 AI 编程对话（Claude Code、Cursor、Codex）结晶为结构化、可语义搜索的知识库。',
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
```

- [ ] **Step 3: Create `site/src/i18n/index.ts`**

```ts
import { en } from './en';
import { zh } from './zh';
import type { Translations } from './en';

const translations: Record<string, Translations> = { en, zh };

export function getTranslations(lang: string): Translations {
  return translations[lang] ?? en;
}

export type { Translations };
```

- [ ] **Step 4: Commit**

```bash
git add site/src/i18n/
git commit -m "feat(site): add i18n translations for EN and ZH"
```

---

### Task 4: Layout Component

**Files:**
- Create: `site/src/layouts/Layout.astro`

- [ ] **Step 1: Create `site/src/layouts/Layout.astro`**

```astro
---
import '../styles/global.css';

interface Props {
  lang: 'en' | 'zh';
  title: string;
  description: string;
}

const { lang, title, description } = Astro.props;
const canonicalURL = new URL(Astro.url.pathname, Astro.site);
const ogImage = new URL('/ChatCrystal/og-image.png', Astro.site);
const altLang = lang === 'en' ? 'zh' : 'en';
const altPath = lang === 'en' ? '/ChatCrystal/zh/' : '/ChatCrystal/';
const altURL = new URL(altPath, Astro.site);
---

<!doctype html>
<html lang={lang === 'zh' ? 'zh-CN' : 'en'}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/ChatCrystal/favicon.svg" />

    <title>{title}</title>
    <meta name="description" content={description} />
    <link rel="canonical" href={canonicalURL} />

    <!-- i18n alternates -->
    <link rel="alternate" hreflang="en" href={lang === 'en' ? canonicalURL : altURL} />
    <link rel="alternate" hreflang="zh-CN" href={lang === 'zh' ? canonicalURL : altURL} />
    <link rel="alternate" hreflang="x-default" href={new URL('/ChatCrystal/', Astro.site)} />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:image" content={ogImage} />
    <meta property="og:url" content={canonicalURL} />
    <meta property="og:locale" content={lang === 'zh' ? 'zh_CN' : 'en_US'} />

    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content={title} />
    <meta name="twitter:description" content={description} />
    <meta name="twitter:image" content={ogImage} />

    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body class="min-h-screen antialiased">
    <slot />
  </body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add site/src/layouts/Layout.astro
git commit -m "feat(site): add Layout with SEO meta, hreflang, and OG tags"
```

---

### Task 5: Static Assets

**Files:**
- Create: `site/public/favicon.svg`
- Copy: `site/public/logo.png` (from `electron/icon.png`)
- Copy: `site/public/screenshots/en/*` (from `docs/screenshots/en/`)
- Copy: `site/public/screenshots/zh/*` (from `docs/screenshots/zh-CN/`)
- Create: `site/public/demos/.gitkeep`

- [ ] **Step 1: Create directory structure and copy assets**

```bash
mkdir -p site/public/screenshots/en site/public/screenshots/zh site/public/demos
cp electron/icon.png site/public/logo.png
cp docs/screenshots/en/*.png site/public/screenshots/en/
cp docs/screenshots/zh-CN/*.png site/public/screenshots/zh/
touch site/public/demos/.gitkeep
```

- [ ] **Step 2: Create `site/public/favicon.svg`**

Copy the existing `electron/icon.svg` if it exists, or create a simple crystal favicon:

```bash
cp electron/icon.svg site/public/favicon.svg 2>/dev/null || true
```

If it doesn't exist, create a minimal SVG:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#7B4DAA"/>
      <stop offset="100%" stop-color="#5B8DEF"/>
    </linearGradient>
  </defs>
  <path d="M16 2 L28 10 L28 22 L16 30 L4 22 L4 10 Z" fill="url(#g)"/>
  <path d="M16 8 L22 12 L22 20 L16 24 L10 20 L10 12 Z" fill="white" opacity="0.3"/>
</svg>
```

- [ ] **Step 3: Create placeholder `site/public/og-image.png`**

For now, copy the logo. A proper OG image will be designed later.

```bash
cp electron/icon.png site/public/og-image.png
```

- [ ] **Step 4: Commit**

```bash
git add site/public/
git commit -m "feat(site): add static assets — logo, screenshots, favicon"
```

---

### Task 6: Footer Component

**Files:**
- Create: `site/src/components/Footer.astro`

- [ ] **Step 1: Create `site/src/components/Footer.astro`**

```astro
---
import type { Translations } from '@/i18n';

interface Props {
  t: Translations;
  lang: 'en' | 'zh';
}

const { t, lang } = Astro.props;
const altLang = lang === 'en' ? 'zh' : 'en';
const altLabel = lang === 'en' ? '中文' : 'EN';
const altHref = lang === 'en' ? '/ChatCrystal/zh/' : '/ChatCrystal/';
---

<footer class="border-t border-white/10 py-12 mt-24">
  <div class="mx-auto max-w-6xl px-6 grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
    <!-- Left: Logo + tagline -->
    <div class="flex items-center gap-3">
      <img src="/ChatCrystal/logo.png" alt="ChatCrystal" class="w-8 h-8" />
      <div>
        <p class="font-semibold text-[var(--color-white)]">ChatCrystal</p>
        <p class="text-sm text-[var(--color-dim-white)]">{t.footer.tagline}</p>
      </div>
    </div>

    <!-- Center: Links -->
    <nav class="flex gap-6 md:justify-center">
      <a href="https://github.com/ZengLiangYi/ChatCrystal" target="_blank" rel="noopener" class="text-sm text-[var(--color-dim-white)] hover:text-[var(--color-white)] transition-colors">{t.footer.github}</a>
      <a href="https://www.npmjs.com/package/chatcrystal" target="_blank" rel="noopener" class="text-sm text-[var(--color-dim-white)] hover:text-[var(--color-white)] transition-colors">{t.footer.npm}</a>
      <a href="https://github.com/ZengLiangYi/ChatCrystal#readme" target="_blank" rel="noopener" class="text-sm text-[var(--color-dim-white)] hover:text-[var(--color-white)] transition-colors">{t.footer.docs}</a>
      <a href="https://github.com/ZengLiangYi/ChatCrystal/releases" target="_blank" rel="noopener" class="text-sm text-[var(--color-dim-white)] hover:text-[var(--color-white)] transition-colors">{t.footer.releases}</a>
    </nav>

    <!-- Right: Language switch -->
    <div class="md:text-right">
      <a href={altHref} class="inline-flex items-center gap-1.5 text-sm text-[var(--color-dim-white)] hover:text-[var(--color-white)] transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        {altLabel}
      </a>
    </div>
  </div>
</footer>
```

- [ ] **Step 2: Commit**

```bash
git add site/src/components/Footer.astro
git commit -m "feat(site): add Footer component"
```

---

### Task 7: IntegrationStrip Component

**Files:**
- Create: `site/src/components/IntegrationStrip.astro`

- [ ] **Step 1: Create `site/src/components/IntegrationStrip.astro`**

```astro
---
import type { Translations } from '@/i18n';

interface Props {
  t: Translations;
}

const { t } = Astro.props;

const sources = [
  { key: 'claudeCode' as const, color: 'var(--color-claude-code)', icon: '⚡' },
  { key: 'cursor' as const, color: 'var(--color-cursor)', icon: '▲' },
  { key: 'codex' as const, color: 'var(--color-codex)', icon: '◆' },
];
---

<section class="py-16">
  <div class="mx-auto max-w-4xl px-6 text-center">
    <p class="text-[var(--color-dim-white)] text-sm mb-8 animate-on-scroll">
      {t.integrations.heading}
    </p>
    <div class="flex flex-col sm:flex-row items-center justify-center gap-6 stagger-children">
      {sources.map((s) => {
        const source = t.integrations[s.key];
        return (
          <div class="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-6 py-4 backdrop-blur-sm">
            <span class="text-2xl" style={`color: ${s.color}`}>{s.icon}</span>
            <div class="text-left">
              <p class="font-medium text-[var(--color-white)]">{source.name}</p>
              <p class="text-xs text-[var(--color-dim-white)]">{source.desc}</p>
            </div>
          </div>
        );
      })}
    </div>
  </div>
</section>
```

- [ ] **Step 2: Commit**

```bash
git add site/src/components/IntegrationStrip.astro
git commit -m "feat(site): add IntegrationStrip component"
```

---

### Task 8: HowItWorks Component

**Files:**
- Create: `site/src/components/HowItWorks.astro`

- [ ] **Step 1: Create `site/src/components/HowItWorks.astro`**

```astro
---
import type { Translations } from '@/i18n';

interface Props {
  t: Translations;
}

const { t } = Astro.props;
const steps = t.howItWorks.steps;
const icons = ['📥', '💎', '🔍'];
---

<section class="py-24">
  <div class="mx-auto max-w-5xl px-6">
    <h2 class="text-3xl font-bold text-center mb-16 animate-on-scroll">
      {t.howItWorks.heading}
    </h2>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-8 relative stagger-children">
      {steps.map((step, i) => (
        <div class="relative text-center">
          {/* Step number */}
          <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-deep-purple)] text-2xl">
            {icons[i]}
          </div>

          <h3 class="text-xl font-semibold mb-2 text-[var(--color-white)]">
            {step.title}
          </h3>
          <p class="text-sm text-[var(--color-dim-white)] leading-relaxed">
            {step.desc}
          </p>

          {/* Connector arrow (hidden on last item and mobile) */}
          {i < steps.length - 1 && (
            <div class="hidden md:block absolute top-7 -right-4 text-[var(--color-muted)]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14m-7-7 7 7-7 7"/></svg>
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
</section>
```

- [ ] **Step 2: Commit**

```bash
git add site/src/components/HowItWorks.astro
git commit -m "feat(site): add HowItWorks component"
```

---

### Task 9: Hero Component (React Island)

**Files:**
- Create: `site/src/components/Hero.tsx`

- [ ] **Step 1: Create `site/src/components/Hero.tsx`**

```tsx
import { useState } from 'react';
import { motion } from 'framer-motion';
import type { Translations } from '@/i18n';

interface Props {
  t: Translations;
  basePath: string;
}

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.12 } },
};

export default function Hero({ t, basePath }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(t.hero.installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="min-h-[80vh] flex items-center py-20">
      <div className="mx-auto max-w-6xl px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        {/* Left: copy */}
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="visible"
          className="flex flex-col gap-6"
        >
          <motion.span
            variants={fadeUp}
            className="inline-flex self-start rounded-full border border-[var(--color-purple)]/40 bg-[var(--color-purple)]/10 px-4 py-1.5 text-xs font-medium text-[var(--color-lavender)]"
          >
            {t.hero.badge}
          </motion.span>

          <motion.h1
            variants={fadeUp}
            className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight tracking-tight"
          >
            {t.hero.title}
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="text-lg text-[var(--color-dim-white)] leading-relaxed max-w-lg"
          >
            {t.hero.subtitle}
          </motion.p>

          {/* CTA group */}
          <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-3">
            {/* Install command */}
            <button
              onClick={handleCopy}
              className="group inline-flex items-center gap-2 rounded-lg bg-[var(--color-purple)] px-5 py-3 font-mono text-sm font-medium text-white hover:bg-[var(--color-deep-purple)] transition-colors cursor-pointer"
            >
              <span className="opacity-50">$</span>
              <span>{t.hero.installCmd}</span>
              <span className="ml-1 text-white/60 group-hover:text-white transition-colors">
                {copied ? '✓' : '⎘'}
              </span>
            </button>

            {/* Download desktop */}
            <a
              href="https://github.com/ZengLiangYi/ChatCrystal/releases"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 px-5 py-3 text-sm font-medium text-[var(--color-white)] hover:bg-white/10 transition-colors"
            >
              {t.hero.downloadDesktop}
            </a>
          </motion.div>

          {/* GitHub stars badge */}
          <motion.div variants={fadeUp}>
            <a href="https://github.com/ZengLiangYi/ChatCrystal" target="_blank" rel="noopener">
              <img
                src="https://img.shields.io/github/stars/ZengLiangYi/ChatCrystal?style=flat&logo=github&color=7B4DAA"
                alt="GitHub stars"
                loading="lazy"
              />
            </a>
          </motion.div>
        </motion.div>

        {/* Right: product demo video */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="relative rounded-xl overflow-hidden border border-white/10 bg-[var(--color-terminal-bg)]"
        >
          {/* Placeholder — replaced with Remotion video when available */}
          <video
            autoPlay
            loop
            muted
            playsInline
            poster={`${basePath}/screenshots/en/conversations.png`}
            className="w-full"
          >
            <source src={`${basePath}/demos/hero.webm`} type="video/webm" />
            <source src={`${basePath}/demos/hero.mp4`} type="video/mp4" />
            {/* Fallback to screenshot */}
            <img src={`${basePath}/screenshots/en/conversations.png`} alt="ChatCrystal" />
          </video>
        </motion.div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add site/src/components/Hero.tsx
git commit -m "feat(site): add Hero component with Framer Motion animations"
```

---

### Task 10: FeatureBento Component (React Island)

**Files:**
- Create: `site/src/components/FeatureBento.tsx`

- [ ] **Step 1: Create `site/src/components/FeatureBento.tsx`**

```tsx
import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { Translations } from '@/i18n';

interface Props {
  t: Translations;
  lang: 'en' | 'zh';
  basePath: string;
}

/** Maps feature index to visual asset. Videos for 0,2,4; screenshots for 1,3,5 */
function getAsset(index: number, lang: string, basePath: string) {
  const screenshotMap: Record<number, string> = {
    1: 'notes',     // Structured notes → notes screenshot
    3: 'search',    // Smart tags → search screenshot (shows tags)
    5: 'graph',     // Desktop app → graph screenshot
  };
  const videoMap: Record<number, string> = {
    0: 'feature-search',    // Semantic search
    2: 'feature-mcp',       // MCP integration
    4: 'feature-cli',       // CLI toolkit
  };

  if (videoMap[index]) {
    return { type: 'video' as const, src: `${basePath}/demos/${videoMap[index]}` };
  }
  const name = screenshotMap[index] ?? 'conversations';
  return { type: 'image' as const, src: `${basePath}/screenshots/${lang}/${name}.png` };
}

function VideoCard({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <video ref={ref} loop muted playsInline className="w-full h-full object-cover">
      <source src={`${src}.webm`} type="video/webm" />
      <source src={`${src}.mp4`} type="video/mp4" />
    </video>
  );
}

export default function FeatureBento({ t, lang, basePath }: Props) {
  // Bento grid: first and last span 2 columns on large screens
  const spanClasses = [
    'md:col-span-2', // Semantic search — wide
    '',
    '',
    '',
    '',
    'md:col-span-2', // Desktop app — wide
  ];

  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="text-3xl font-bold text-center mb-16">
          {t.features.heading}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {t.features.items.map((item, i) => {
            const asset = getAsset(i, lang, basePath);
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                className={`rounded-xl border border-white/10 bg-white/5 overflow-hidden ${spanClasses[i]}`}
              >
                {/* Visual area */}
                <div className="aspect-video bg-[var(--color-terminal-bg)]">
                  {asset.type === 'video' ? (
                    <VideoCard src={asset.src} />
                  ) : (
                    <img
                      src={asset.src}
                      alt={item.title}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>

                {/* Text */}
                <div className="p-5">
                  <h3 className="font-semibold text-[var(--color-white)] mb-1">{item.title}</h3>
                  <p className="text-sm text-[var(--color-dim-white)]">{item.desc}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add site/src/components/FeatureBento.tsx
git commit -m "feat(site): add FeatureBento component with video auto-play"
```

---

### Task 11: LocalFirst Component (React Island)

**Files:**
- Create: `site/src/components/LocalFirst.tsx`

- [ ] **Step 1: Create `site/src/components/LocalFirst.tsx`**

Architecture diagram animated with Framer Motion — nodes appear sequentially, then connection lines draw in.

```tsx
import { motion } from 'framer-motion';
import type { Translations } from '@/i18n';

interface Props {
  t: Translations;
}

const nodeVariants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1 },
};

const lineVariants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: { pathLength: 1, opacity: 1 },
};

const icons = ['🔒', '📖', '🎛️'];

export default function LocalFirst({ t }: Props) {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        {/* Left: Architecture diagram */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          className="flex justify-center"
        >
          <svg viewBox="0 0 400 300" className="w-full max-w-md" fill="none">
            {/* Connections — draw after nodes */}
            <motion.line
              x1="200" y1="60" x2="200" y2="130"
              stroke="var(--color-purple)" strokeWidth="2"
              variants={lineVariants}
              transition={{ delay: 0.8, duration: 0.5 }}
            />
            <motion.line
              x1="200" y1="170" x2="120" y2="230"
              stroke="var(--color-purple)" strokeWidth="2"
              variants={lineVariants}
              transition={{ delay: 1.0, duration: 0.5 }}
            />
            <motion.line
              x1="200" y1="170" x2="280" y2="230"
              stroke="var(--color-purple)" strokeWidth="2"
              variants={lineVariants}
              transition={{ delay: 1.0, duration: 0.5 }}
            />

            {/* Node: AI Conversations (top) */}
            <motion.g variants={nodeVariants} transition={{ delay: 0.2 }}>
              <rect x="130" y="20" width="140" height="40" rx="8" fill="var(--color-deep-purple)" />
              <text x="200" y="45" textAnchor="middle" fill="var(--color-white)" fontSize="13" fontFamily="Inter, sans-serif">AI Conversations</text>
            </motion.g>

            {/* Node: ChatCrystal (center) */}
            <motion.g variants={nodeVariants} transition={{ delay: 0.4 }}>
              <rect x="130" y="130" width="140" height="40" rx="8" fill="var(--color-purple)" />
              <text x="200" y="152" textAnchor="middle" fill="white" fontSize="13" fontWeight="600" fontFamily="Inter, sans-serif">💎 ChatCrystal</text>
            </motion.g>

            {/* Node: SQLite (bottom-left) */}
            <motion.g variants={nodeVariants} transition={{ delay: 0.6 }}>
              <rect x="60" y="230" width="120" height="40" rx="8" fill="var(--color-cobalt-blue)" />
              <text x="120" y="255" textAnchor="middle" fill="var(--color-white)" fontSize="12" fontFamily="Inter, sans-serif">SQLite (local)</text>
            </motion.g>

            {/* Node: Vectra Index (bottom-right) */}
            <motion.g variants={nodeVariants} transition={{ delay: 0.6 }}>
              <rect x="220" y="230" width="120" height="40" rx="8" fill="var(--color-cobalt-blue)" />
              <text x="280" y="255" textAnchor="middle" fill="var(--color-white)" fontSize="12" fontFamily="Inter, sans-serif">Vector Index</text>
            </motion.g>

            {/* "Your machine" boundary */}
            <motion.rect
              x="30" y="100" width="340" height="200" rx="12"
              stroke="var(--color-muted)" strokeWidth="1" strokeDasharray="6 4"
              fill="none"
              variants={lineVariants}
              transition={{ delay: 1.3, duration: 0.6 }}
            />
            <motion.text
              x="50" y="118"
              fill="var(--color-muted)" fontSize="11" fontFamily="Inter, sans-serif"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              transition={{ delay: 1.6 }}
              viewport={{ once: true }}
            >
              Your machine
            </motion.text>
          </svg>
        </motion.div>

        {/* Right: Trust points */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          transition={{ staggerChildren: 0.15, delayChildren: 0.3 }}
          className="flex flex-col gap-8"
        >
          <h2 className="text-3xl font-bold">{t.localFirst.heading}</h2>

          {t.localFirst.points.map((point, i) => (
            <motion.div
              key={i}
              variants={{ hidden: { opacity: 0, x: 24 }, visible: { opacity: 1, x: 0 } }}
              className="flex gap-4"
            >
              <span className="text-2xl mt-0.5">{icons[i]}</span>
              <div>
                <h3 className="font-semibold text-[var(--color-white)]">{point.title}</h3>
                <p className="text-sm text-[var(--color-dim-white)] mt-1">{point.desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add site/src/components/LocalFirst.tsx
git commit -m "feat(site): add LocalFirst component with animated architecture diagram"
```

---

### Task 12: CliShowcase Component (React Island)

**Files:**
- Create: `site/src/components/CliShowcase.tsx`

- [ ] **Step 1: Create `site/src/components/CliShowcase.tsx`**

Displays a Remotion-rendered terminal video. Falls back to a static terminal mockup if video isn't available yet.

```tsx
import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { Translations } from '@/i18n';

interface Props {
  t: Translations;
  basePath: string;
}

export default function CliShowcase({ t, basePath }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.3 }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="py-24">
      <div className="mx-auto max-w-4xl px-6">
        <h2 className="text-3xl font-bold text-center mb-12">
          {t.cli.heading}
        </h2>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="rounded-xl border border-white/10 overflow-hidden bg-[var(--color-terminal-bg)]"
        >
          {/* Terminal title bar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
            <span className="w-3 h-3 rounded-full bg-red-500/70" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
            <span className="w-3 h-3 rounded-full bg-green-500/70" />
            <span className="ml-2 text-xs text-[var(--color-muted)] font-mono">terminal</span>
          </div>

          {/* Video content */}
          <div className="aspect-[16/9]">
            <video
              ref={videoRef}
              loop
              muted
              playsInline
              className="w-full h-full object-cover"
            >
              <source src={`${basePath}/demos/cli-showcase.webm`} type="video/webm" />
              <source src={`${basePath}/demos/cli-showcase.mp4`} type="video/mp4" />
            </video>

            {/* Static fallback when no video */}
            <noscript>
              <div className="p-6 font-mono text-sm leading-relaxed">
                <p><span className="text-[var(--color-codex)]">$</span> crystal import</p>
                <p className="text-[var(--color-dim-white)]">Scanning Claude Code conversations...</p>
                <p className="text-[var(--color-dim-white)]">Found 42 new conversations. Imported.</p>
                <br />
                <p><span className="text-[var(--color-codex)]">$</span> crystal search "JWT authentication"</p>
                <p className="text-[var(--color-dim-white)]">3 results found:</p>
                <p className="text-[var(--color-claude-code)]">  1. JWT middleware implementation guide</p>
                <br />
                <p><span className="text-[var(--color-codex)]">$</span> crystal notes list --tag auth</p>
                <p className="text-[var(--color-dim-white)]">5 notes tagged with "auth"</p>
              </div>
            </noscript>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add site/src/components/CliShowcase.tsx
git commit -m "feat(site): add CliShowcase component with terminal video player"
```

---

### Task 13: English Page

**Files:**
- Create: `site/src/pages/index.astro`

- [ ] **Step 1: Create `site/src/pages/index.astro`**

```astro
---
import Layout from '@/layouts/Layout.astro';
import { getTranslations } from '@/i18n';
import Hero from '@/components/Hero.tsx';
import IntegrationStrip from '@/components/IntegrationStrip.astro';
import HowItWorks from '@/components/HowItWorks.astro';
import FeatureBento from '@/components/FeatureBento.tsx';
import LocalFirst from '@/components/LocalFirst.tsx';
import CliShowcase from '@/components/CliShowcase.tsx';
import Footer from '@/components/Footer.astro';

const lang = 'en';
const t = getTranslations(lang);
const basePath = '/ChatCrystal';
---

<Layout lang={lang} title={t.meta.title} description={t.meta.description}>
  <main>
    <Hero client:load t={t} basePath={basePath} />
    <IntegrationStrip t={t} />
    <HowItWorks t={t} />
    <FeatureBento client:visible t={t} lang={lang} basePath={basePath} />
    <LocalFirst client:visible t={t} />
    <CliShowcase client:visible t={t} basePath={basePath} />
  </main>
  <Footer t={t} lang={lang} />
</Layout>
```

- [ ] **Step 2: Commit**

```bash
git add site/src/pages/index.astro
git commit -m "feat(site): add English landing page"
```

---

### Task 14: Chinese Page

**Files:**
- Create: `site/src/pages/zh/index.astro`

- [ ] **Step 1: Create `site/src/pages/zh/index.astro`**

```astro
---
import Layout from '@/layouts/Layout.astro';
import { getTranslations } from '@/i18n';
import Hero from '@/components/Hero.tsx';
import IntegrationStrip from '@/components/IntegrationStrip.astro';
import HowItWorks from '@/components/HowItWorks.astro';
import FeatureBento from '@/components/FeatureBento.tsx';
import LocalFirst from '@/components/LocalFirst.tsx';
import CliShowcase from '@/components/CliShowcase.tsx';
import Footer from '@/components/Footer.astro';

const lang = 'zh';
const t = getTranslations(lang);
const basePath = '/ChatCrystal';
---

<Layout lang={lang} title={t.meta.title} description={t.meta.description}>
  <main>
    <Hero client:load t={t} basePath={basePath} />
    <IntegrationStrip t={t} />
    <HowItWorks t={t} />
    <FeatureBento client:visible t={t} lang={lang} basePath={basePath} />
    <LocalFirst client:visible t={t} />
    <CliShowcase client:visible t={t} basePath={basePath} />
  </main>
  <Footer t={t} lang={lang} />
</Layout>
```

- [ ] **Step 2: Commit**

```bash
git add site/src/pages/zh/index.astro
git commit -m "feat(site): add Chinese landing page"
```

---

### Task 15: Build Verification

- [ ] **Step 1: Run full Astro build**

```bash
cd site && npm run build
```

Expected: builds successfully to `site/dist/`, output includes:
- `dist/index.html` (EN)
- `dist/zh/index.html` (ZH)
- `dist/sitemap-index.xml`

- [ ] **Step 2: Preview locally**

```bash
cd site && npm run preview
```

Open `http://localhost:4321/ChatCrystal/` in browser. Verify:
- Hero section loads with animations
- All sections visible when scrolling
- Scroll animations trigger on IntegrationStrip, HowItWorks
- Language switch in footer navigates between `/ChatCrystal/` and `/ChatCrystal/zh/`
- Screenshots load (videos will 404 until Remotion renders them — this is expected)

- [ ] **Step 3: Fix any build errors and commit**

```bash
git add -A site/
git commit -m "fix(site): resolve build issues"
```

---

### Task 16: GitHub Actions Deploy Workflow

**Files:**
- Create: `.github/workflows/deploy-site.yml`

- [ ] **Step 1: Create `.github/workflows/deploy-site.yml`**

```yaml
name: Deploy Landing Page

on:
  push:
    branches: [main]
    paths:
      - 'site/**'
      - '.github/workflows/deploy-site.yml'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: site/package-lock.json

      - name: Install dependencies
        working-directory: site
        run: npm ci

      - name: Build site
        working-directory: site
        run: npm run build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: site/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy-site.yml
git commit -m "ci: add GitHub Actions workflow for landing page deployment"
```

---

### Task 17: Root Integration

**Files:**
- Modify: `package.json` (root) — add site scripts

- [ ] **Step 1: Add site scripts to root `package.json`**

Add these scripts to the root `package.json`:

```json
{
  "scripts": {
    "dev:site": "cd site && npm run dev",
    "build:site": "cd site && npm run build",
    "preview:site": "cd site && npm run preview"
  }
}
```

Note: `site/` is intentionally NOT added to workspaces — it's an independent Astro project with its own dependency tree, avoiding conflicts with the existing React 19 + Vite 8 client.

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "feat: add site dev/build/preview scripts to root"
```

---

### Task 18: Final Verification + Squash Commit

- [ ] **Step 1: Full clean build from root**

```bash
npm run build:site
```

Expected: success, `site/dist/` contains static HTML.

- [ ] **Step 2: Verify static output**

```bash
ls site/dist/
ls site/dist/zh/
cat site/dist/index.html | head -30
```

Expected: both `index.html` files exist, EN version has `lang="en"`, meta tags present.

- [ ] **Step 3: Verify no regressions in main app**

```bash
npm run build
```

Expected: main app (server + client) still builds fine — `site/` is isolated.

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "feat(site): landing page ready for deployment"
```
