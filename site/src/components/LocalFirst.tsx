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
            <motion.line x1="200" y1="60" x2="200" y2="130" stroke="var(--color-purple)" strokeWidth="2" variants={lineVariants} transition={{ delay: 0.8, duration: 0.5 }} />
            <motion.line x1="200" y1="170" x2="120" y2="230" stroke="var(--color-purple)" strokeWidth="2" variants={lineVariants} transition={{ delay: 1.0, duration: 0.5 }} />
            <motion.line x1="200" y1="170" x2="280" y2="230" stroke="var(--color-purple)" strokeWidth="2" variants={lineVariants} transition={{ delay: 1.0, duration: 0.5 }} />

            <motion.g variants={nodeVariants} transition={{ delay: 0.2 }}>
              <rect x="130" y="20" width="140" height="40" rx="8" fill="var(--color-deep-purple)" />
              <text x="200" y="45" textAnchor="middle" fill="var(--color-white)" fontSize="13" fontFamily="Inter, sans-serif">AI Conversations</text>
            </motion.g>

            <motion.g variants={nodeVariants} transition={{ delay: 0.4 }}>
              <rect x="130" y="130" width="140" height="40" rx="8" fill="var(--color-purple)" />
              <text x="200" y="152" textAnchor="middle" fill="white" fontSize="13" fontWeight="600" fontFamily="Inter, sans-serif">💎 ChatCrystal</text>
            </motion.g>

            <motion.g variants={nodeVariants} transition={{ delay: 0.6 }}>
              <rect x="60" y="230" width="120" height="40" rx="8" fill="var(--color-cobalt-blue)" />
              <text x="120" y="255" textAnchor="middle" fill="var(--color-white)" fontSize="12" fontFamily="Inter, sans-serif">SQLite (local)</text>
            </motion.g>

            <motion.g variants={nodeVariants} transition={{ delay: 0.6 }}>
              <rect x="220" y="230" width="120" height="40" rx="8" fill="var(--color-cobalt-blue)" />
              <text x="280" y="255" textAnchor="middle" fill="var(--color-white)" fontSize="12" fontFamily="Inter, sans-serif">Vector Index</text>
            </motion.g>

            <motion.rect x="30" y="100" width="340" height="200" rx="12" stroke="var(--color-muted)" strokeWidth="1" strokeDasharray="6 4" fill="none" variants={lineVariants} transition={{ delay: 1.3, duration: 0.6 }} />
            <motion.text x="50" y="118" fill="var(--color-muted)" fontSize="11" fontFamily="Inter, sans-serif" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} transition={{ delay: 1.6 }} viewport={{ once: true }}>
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
            <motion.div key={i} variants={{ hidden: { opacity: 0, x: 24 }, visible: { opacity: 1, x: 0 } }} className="flex gap-4">
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
