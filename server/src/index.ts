import Fastify, { type FastifyInstance } from 'fastify';
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
import { configRoutes } from './routes/config.js';
import { relationRoutes } from './routes/relations.js';

// Initialize parser adapters (registers built-in adapters)
import './parser/index.js';
import { startWatcher } from './watcher/index.js';

export interface ServerInstance {
  app: FastifyInstance;
  port: number;
  shutdown: () => Promise<void>;
}

/**
 * Create and start the Fastify server.
 * Used by both standalone mode and Electron main process.
 */
export async function createServer(options?: {
  port?: number;
  host?: string;
}): Promise<ServerInstance> {
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
  await app.register(configRoutes);
  await app.register(relationRoutes);

  // Serve frontend in production
  // Try multiple possible paths (source layout vs compiled layout)
  const candidatePaths = [
    resolve(import.meta.dirname, '../../client/dist'),       // source: server/src/ → client/dist/
    resolve(import.meta.dirname, '../../../../client/dist'),  // compiled: server/dist/server/src/ → client/dist/
  ];
  const clientDist = candidatePaths.find((p) => existsSync(p)) ?? candidatePaths[0];
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

  // Log provider config
  console.log(`[LLM] Provider: ${appConfig.llm.provider} / ${appConfig.llm.model}`);
  console.log(`[Embedding] Provider: ${appConfig.embedding.provider} / ${appConfig.embedding.model}`);

  // Start file watcher
  const watcher = startWatcher();

  // Start server
  const port = options?.port ?? appConfig.port;
  const host = options?.host ?? '0.0.0.0';
  await app.listen({ port, host });
  console.log(`\n  ChatCrystal server running at http://localhost:${port}\n`);

  // Graceful shutdown function
  async function shutdown() {
    console.log('[Server] Shutting down...');
    await watcher.close();
    closeDatabase();
    await app.close();
  }

  return { app, port, shutdown };
}

// Standalone mode (not Electron)
if (!process.env.ELECTRON) {
  createServer()
    .then(({ shutdown }) => {
      const handle = () => {
        shutdown().then(() => process.exit(0));
      };
      process.on('SIGINT', handle);
      process.on('SIGTERM', handle);
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}
