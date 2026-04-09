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
    <section id="cli" className="py-24">
      <div className="mx-auto max-w-4xl px-6">
        <h2 className="text-3xl font-bold text-center mb-12">
          {t.cli.heading}
        </h2>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="rounded-xl overflow-hidden"
        >
          <video ref={videoRef} loop muted playsInline className="w-full">
            <source src={`${basePath}/demos/cli-showcase.webm`} type="video/webm" />
            <source src={`${basePath}/demos/cli-showcase.mp4`} type="video/mp4" />
          </video>
        </motion.div>
      </div>
    </section>
  );
}
