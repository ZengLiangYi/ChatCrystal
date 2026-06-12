import { motion } from 'framer-motion';
import type { Translations } from '@/i18n';

interface Props {
  t: Translations;
}

const trustIcons = [
  <svg key="shield" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  <svg key="code" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
  <svg key="sliders" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>,
];

const nodeVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

export default function LocalFirst({ t }: Props) {
  return (
    <section className="py-24">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 lg:grid-cols-[1.05fr_0.95fr]">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          transition={{ staggerChildren: 0.12 }}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] p-5 shadow-sm"
        >
          <div className="mb-5 flex items-center justify-between border-b border-[var(--color-border)] pb-4">
            <span className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
              {t.localFirst.yourMachine}
            </span>
            <span className="rounded-full bg-[rgba(90,138,92,0.13)] px-3 py-1 text-xs font-semibold text-[var(--color-success)]">
              local-first
            </span>
          </div>

          <div className="grid gap-4">
            <motion.div variants={nodeVariants} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-paper-soft)] p-4">
              <div className="text-sm font-semibold text-[var(--color-primary-deep)]">AI conversations</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {['Claude Code', 'Cursor', 'Codex CLI', 'Trae', 'Copilot'].map((source) => (
                  <span key={source} className="rounded-full border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-1 text-xs text-[var(--color-dim-white)]">
                    {source}
                  </span>
                ))}
              </div>
            </motion.div>

            <motion.div variants={nodeVariants} className="mx-auto flex h-10 w-px bg-[var(--color-border)]" />

            <motion.div variants={nodeVariants} className="mx-auto w-full max-w-sm rounded-lg bg-[var(--color-primary)] px-5 py-4 text-center text-sm font-semibold text-[#FFFDF8] shadow-[0_14px_30px_rgba(184,88,75,0.2)]">
              ChatCrystal
            </motion.div>

            <motion.div variants={nodeVariants} className="mx-auto h-10 w-px bg-[var(--color-border)]" />

            <motion.div variants={nodeVariants} className="grid gap-3 sm:grid-cols-3">
              {['SQLite', 'Vector Index', 'MCP'].map((label) => (
                <div key={label} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-paper-soft)] p-4 text-center">
                  <div className="font-mono text-sm font-semibold text-[var(--color-primary-deep)]">{label}</div>
                  <div className="mt-1 text-xs text-[var(--color-muted)]">on device</div>
                </div>
              ))}
            </motion.div>
          </div>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          transition={{ staggerChildren: 0.15, delayChildren: 0.15 }}
          className="flex flex-col gap-7"
        >
          <h2 className="font-display text-3xl font-bold text-[var(--color-primary-deep)] sm:text-4xl">
            {t.localFirst.heading}
          </h2>
          {t.localFirst.points.map((point, i) => (
            <motion.div key={point.title} variants={nodeVariants} className="flex gap-4">
              <span className="mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] shadow-sm">
                {trustIcons[i]}
              </span>
              <div>
                <h3 className="font-semibold text-[var(--color-primary-deep)]">{point.title}</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--color-dim-white)]">{point.desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
