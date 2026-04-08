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
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
            <span className="w-3 h-3 rounded-full bg-red-500/70" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
            <span className="w-3 h-3 rounded-full bg-green-500/70" />
            <span className="ml-2 text-xs text-[var(--color-muted)] font-mono">terminal</span>
          </div>

          <div className="aspect-[16/9]">
            <video ref={videoRef} loop muted playsInline className="w-full h-full object-cover">
              <source src={`${basePath}/demos/cli-showcase.webm`} type="video/webm" />
              <source src={`${basePath}/demos/cli-showcase.mp4`} type="video/mp4" />
            </video>

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
