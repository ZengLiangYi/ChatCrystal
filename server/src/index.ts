import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { appConfig } from './config.js';
import {
  initDatabase,
  closeDatabase,
  startAutoSave,
} from './db/index.js';
import { statusRoutes } from './routes/status.js';
import { importRoutes } from './routes/import.js';
import { conversationRoutes } from './routes/conversations.js';
import { noteRoutes } from './routes/notes.js';

// Initialize parser adapters (registers built-in adapters)
import './parser/index.js';
import { startWatcher } from './watcher/index.js';

async function main() {
  const app = Fastify({ logger: true });

  // CORS for dev (client on different port)
  await app.register(cors, { origin: true });

  // Initialize database
  await initDatabase();
  startAutoSave();

  // Register routes
  await app.register(statusRoutes);
  await app.register(importRoutes);
  await app.register(conversationRoutes);
  await app.register(noteRoutes);

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[Server] Shutting down...');
    closeDatabase();
    app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Serve frontend in production
  const clientDist = resolve(import.meta.dirname, '../../client/dist');
  if (existsSync(clientDist)) {
    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: '/',
      wildcard: false,
    });
    // SPA fallback: serve index.html for non-API routes
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        reply.status(404).send({ success: false, error: 'Not Found' });
      } else {
        reply.sendFile('index.html');
      }
    });
    console.log('[Server] Serving frontend from', clientDist);
  }

  // Start file watcher
  startWatcher();

  // Start server
  await app.listen({ port: appConfig.port, host: '0.0.0.0' });
  console.log(
    `\n  ChatCrystal server running at http://localhost:${appConfig.port}\n`,
  );
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
