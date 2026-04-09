import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { Translations } from '@/i18n';

interface Props {
  t: Translations;
  lang: 'en' | 'zh';
  basePath: string;
}

function getAsset(index: number, lang: string, basePath: string) {
  const screenshotMap: Record<number, string> = {
    1: 'notes',
    3: 'search',
    5: 'graph',
  };
  const videoMap: Record<number, string> = {
    0: 'feature-search',
    2: 'feature-mcp',
    4: 'feature-cli',
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
        if (entry.isIntersecting) video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.3 }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <video ref={ref} loop muted playsInline className="w-full h-full object-contain">
      <source src={`${src}.webm`} type="video/webm" />
      <source src={`${src}.mp4`} type="video/mp4" />
    </video>
  );
}

// Bento grid config per card:
// col-span controls width, row-span controls height via auto-rows-[80px] unit
const CARD_CONFIG = [
  { colSpan: 'md:col-span-2', rowSpan: 'md:row-span-5' },  // Semantic Search — wide video
  { colSpan: '',              rowSpan: 'md:row-span-5' },  // Structured Notes — screenshot
  { colSpan: '',              rowSpan: 'md:row-span-5' },  // MCP — video
  { colSpan: '',              rowSpan: 'md:row-span-5' },  // Smart Tags — screenshot
  { colSpan: '',              rowSpan: 'md:row-span-5' },  // CLI — video
  { colSpan: 'md:col-span-2', rowSpan: 'md:row-span-5' },  // Desktop — screenshot wide
];

export default function FeatureBento({ t, lang, basePath }: Props) {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="text-3xl font-bold text-center mb-16">
          {t.features.heading}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 md:auto-rows-[80px] gap-4">
          {t.features.items.map((item, i) => {
            const asset = getAsset(i, lang, basePath);
            const { colSpan, rowSpan } = CARD_CONFIG[i];
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                className={`rounded-xl border border-white/10 bg-white/5 overflow-hidden flex flex-col ${colSpan} ${rowSpan}`}
              >
                {/* Media area — flex-1 fills available space, object-contain keeps content intact */}
                <div className="flex-1 min-h-0 bg-[var(--color-terminal-bg)]">
                  {asset.type === 'video' ? (
                    <VideoCard src={asset.src} />
                  ) : (
                    <img
                      src={asset.src}
                      alt={item.title}
                      loading="lazy"
                      className="w-full h-full object-contain"
                    />
                  )}
                </div>
                {/* Text area — fixed height */}
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
