import { motion } from 'framer-motion';
import type { Translations } from '@/i18n';

interface Props {
  t: Translations;
  basePath: string;
}

const endpoints = ['REST API', 'Desktop', 'CLI', 'MCP'];

export default function CliShowcase({ t }: Props) {
  return (
    <section id="cli" className="py-24">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-6 lg:grid-cols-[0.85fr_1.15fr]">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--color-primary)]">
            {t.cli.eyebrow}
          </p>
          <h2 className="font-display text-3xl font-bold text-[var(--color-primary-deep)] sm:text-4xl">
            {t.cli.heading}
          </h2>
          <p className="mt-4 max-w-xl text-base leading-7 text-[var(--color-dim-white)]">
            {t.cli.subheading}
          </p>
          <div className="mt-7 flex flex-wrap gap-2">
            {endpoints.map((endpoint) => (
              <span key={endpoint} className="rounded-full border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-1.5 text-xs font-semibold text-[var(--color-dim-white)] shadow-sm">
                {endpoint}
              </span>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-terminal-bg)] shadow-[0_24px_60px_rgba(44,42,38,0.18)]"
        >
          <div className="flex h-10 items-center justify-between border-b border-[#ECE8E1]/10 px-4">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-warning)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-success)]" />
            </div>
            <span className="font-mono text-xs text-[#ECE8E1]/45">crystal</span>
          </div>
          <div className="space-y-5 p-5 font-mono text-sm">
            {t.cli.commands.map((item) => (
              <div key={item.command}>
                <div className="flex items-start gap-3 text-[#ECE8E1]">
                  <span className="text-[var(--color-primary-hover)]">$</span>
                  <span>{item.command}</span>
                </div>
                <div className="mt-2 pl-6 text-xs text-[#ECE8E1]/55">{item.note}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
