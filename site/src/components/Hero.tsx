import { useState } from 'react';
import { motion } from 'framer-motion';
import type { Translations } from '@/i18n';

interface Props {
  t: Translations;
  lang: 'en' | 'zh';
  basePath: string;
}

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.12 } },
};

export default function Hero({ t, lang, basePath }: Props) {
  const [copied, setCopied] = useState(false);
  const heroScreenshot = lang === 'zh' ? 'dashboard' : 'conversations';
  const secondaryScreenshot = lang === 'zh' ? 'conversations' : 'graph';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(t.hero.installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="relative overflow-hidden pt-24 pb-16 sm:pt-28 lg:pb-20">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 lg:grid-cols-[0.9fr_1.1fr]">
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="visible"
          className="flex flex-col gap-6"
        >
          <motion.span
            variants={fadeUp}
            className="inline-flex self-start rounded-full border border-[var(--color-primary)]/25 bg-[var(--color-paper)] px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-primary)] shadow-sm"
          >
            {t.hero.badge}
          </motion.span>

          <motion.h1
            variants={fadeUp}
            className="font-display text-5xl font-bold leading-none text-[var(--color-primary-deep)] sm:text-6xl lg:text-7xl"
          >
            {t.hero.title}
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="max-w-xl text-lg leading-8 text-[var(--color-dim-white)]"
          >
            {t.hero.subtitle}
          </motion.p>

          <motion.div variants={fadeUp} className="grid max-w-xl grid-cols-3 gap-3">
            {t.hero.highlights.map((item) => (
              <div key={item.label} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-3 shadow-sm">
                <div className="font-display text-2xl font-bold text-[var(--color-primary)]">{item.value}</div>
                <div className="mt-1 text-xs font-medium leading-snug text-[var(--color-dim-white)]">{item.label}</div>
              </div>
            ))}
          </motion.div>

          <motion.div variants={fadeUp} className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={handleCopy}
              className="group inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-5 py-3 font-mono text-sm font-semibold text-[#FFFDF8] shadow-[0_14px_30px_rgba(184,88,75,0.22)] transition-colors hover:bg-[var(--color-primary-hover)]"
            >
              <span className="opacity-50">$</span>
              <span>{t.hero.installCmd}</span>
              <span className="ml-1 text-[#FFFDF8]/65 transition-colors group-hover:text-[#FFFDF8]">
                {copied ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                )}
              </span>
            </button>

            <a
              href="https://github.com/ZengLiangYi/ChatCrystal/releases"
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] px-5 py-3 text-sm font-semibold text-[var(--color-primary-deep)] shadow-sm transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
            >
              {t.hero.downloadDesktop}
            </a>
          </motion.div>

          <motion.div variants={fadeUp}>
            <a href="https://github.com/ZengLiangYi/ChatCrystal" target="_blank" rel="noopener">
              <img
                src="https://img.shields.io/github/stars/ZengLiangYi/ChatCrystal?style=flat&logo=github&color=B8584B"
                alt="GitHub stars"
                loading="lazy"
              />
            </a>
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="relative"
        >
          <div className="paper-panel overflow-hidden rounded-lg">
            <div className="flex h-10 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-paper-soft)] px-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-warning)]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-success)]" />
              </div>
              <span className="font-mono text-xs text-[var(--color-muted)]">localhost:3721</span>
            </div>
            <img
              src={`${basePath}/screenshots/${lang}/${heroScreenshot}.png`}
              alt="ChatCrystal workspace"
              className="w-full"
            />
          </div>

          <div className="mt-4 grid grid-cols-[0.7fr_1fr] gap-4">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] p-4 shadow-sm">
              <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-muted)]">Dawn Haze</p>
              <p className="mt-2 text-sm font-semibold text-[var(--color-primary-deep)]">SQLite · Vector · MCP</p>
            </div>
            <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] shadow-sm">
              <img
                src={`${basePath}/screenshots/${lang}/${secondaryScreenshot}.png`}
                alt="ChatCrystal secondary view"
                className="h-full w-full object-cover object-top"
              />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
