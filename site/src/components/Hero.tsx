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
            className="inline-flex self-start rounded-full border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 px-4 py-1.5 text-xs font-medium text-[var(--color-accent)]"
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
            <button
              onClick={handleCopy}
              className="group inline-flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-5 py-3 font-mono text-sm font-medium text-white hover:bg-[var(--color-primary-deep)] transition-colors cursor-pointer"
            >
              <span className="opacity-50">$</span>
              <span>{t.hero.installCmd}</span>
              <span className="ml-1 text-white/60 group-hover:text-white transition-colors">
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
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 px-5 py-3 text-sm font-medium text-[var(--color-white)] hover:bg-white/10 transition-colors"
            >
              {t.hero.downloadDesktop}
            </a>
          </motion.div>

          {/* GitHub stars badge */}
          <motion.div variants={fadeUp}>
            <a href="https://github.com/ZengLiangYi/ChatCrystal" target="_blank" rel="noopener">
              <img
                src="https://img.shields.io/github/stars/ZengLiangYi/ChatCrystal?style=flat&logo=github&color=5A5FD6"
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
          <video
            autoPlay
            loop
            muted
            playsInline
            poster={`${basePath}/screenshots/${lang}/conversations.png`}
            className="w-full"
          >
            <source src={`${basePath}/demos/hero.webm`} type="video/webm" />
            <source src={`${basePath}/demos/hero.mp4`} type="video/mp4" />
            <img src={`${basePath}/screenshots/${lang}/conversations.png`} alt="ChatCrystal" />
          </video>
        </motion.div>
      </div>
    </section>
  );
}
