import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        onboarding: resolve(import.meta.dirname, 'electron-onboarding/index.html'),
      },
    },
  },
  server: {
    port: 13721,
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://localhost:3721',
    },
  },
})
