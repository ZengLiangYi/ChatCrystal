import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

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
    build: {
      // Agent logos are small SVGs; keeping them as files instead of inlining
      // them into every copy of the marquee markup keeps the HTML light and
      // lets the browser cache each logo once.
      assetsInlineLimit: 0,
    },
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});

