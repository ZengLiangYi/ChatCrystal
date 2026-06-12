import { motion } from 'framer-motion';
import type { Translations } from '@/i18n';

interface Props {
  t: Translations;
  lang: 'en' | 'zh';
  basePath: string;
}

type Visual =
  | { kind: 'image'; name: string; tone: string }
  | { kind: 'terminal'; tone: string };

function getVisual(index: number, lang: 'en' | 'zh'): Visual {
  const visuals: Visual[] = [
    { kind: 'image', name: lang === 'zh' ? 'dashboard' : 'conversations', tone: 'bg-[rgba(184,88,75,0.08)]' },
    { kind: 'image', name: 'graph', tone: 'bg-[rgba(74,127,165,0.1)]' },
    { kind: 'image', name: 'search', tone: 'bg-[rgba(90,138,92,0.1)]' },
    { kind: 'image', name: 'notes', tone: 'bg-[rgba(196,136,58,0.1)]' },
    { kind: 'terminal', tone: 'bg-[rgba(44,42,38,0.08)]' },
    { kind: 'image', name: lang === 'zh' ? 'setting' : 'conversations', tone: 'bg-[rgba(82,124,155,0.1)]' },
  ];
  return visuals[index] ?? visuals[0];
}

const spanClasses: Record<number, string> = {
  0: 'lg:col-span-2',
  1: 'lg:col-span-1',
  4: 'lg:col-span-1',
  5: 'lg:col-span-2',
};

function TerminalVisual() {
  const lines = [
    ['$', 'crystal mcp'],
    ['tool', 'recall_for_task  project=ChatCrystal'],
    ['match', 'Dawn Haze theme tokens · 0.92'],
    ['write', 'task memory saved locally'],
  ];

  return (
    <div className="h-56 bg-[var(--color-terminal-bg)] p-4 font-mono text-xs text-[#ECE8E1]">
      <div className="mb-4 flex items-center justify-between border-b border-[#ECE8E1]/10 pb-3">
        <span className="text-[#ECE8E1]/55">mcp://chatcrystal</span>
        <span className="rounded bg-[var(--color-primary)] px-2 py-1 text-[10px] font-semibold text-[#FFFDF8]">LOCAL</span>
      </div>
      <div className="space-y-3">
        {lines.map(([label, text]) => (
          <div key={text} className="grid grid-cols-[3.5rem_1fr] gap-3">
            <span className="text-[#ECE8E1]/45">{label}</span>
            <span className="text-[#ECE8E1]">{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FeatureBento({ t, lang, basePath }: Props) {
  return (
    <section id="features" className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--color-primary)]">
            {t.features.eyebrow}
          </p>
          <h2 className="font-display text-3xl font-bold text-[var(--color-primary-deep)] sm:text-4xl">
            {t.features.heading}
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {t.features.items.map((item, i) => {
            const visual = getVisual(i, lang);
            return (
              <motion.article
                key={item.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ delay: i * 0.06, duration: 0.45 }}
                className={`overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] shadow-sm ${spanClasses[i] ?? ''}`}
              >
                <div className={`relative overflow-hidden border-b border-[var(--color-border)] ${visual.tone}`}>
                  {visual.kind === 'terminal' ? (
                    <TerminalVisual />
                  ) : (
                    <img
                      src={`${basePath}/screenshots/${lang}/${visual.name}.png`}
                      alt={item.title}
                      loading="lazy"
                      className="h-56 w-full object-cover object-top"
                    />
                  )}
                </div>
                <div className="p-5">
                  <h3 className="text-lg font-semibold text-[var(--color-primary-deep)]">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--color-dim-white)]">{item.desc}</p>
                </div>
              </motion.article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
