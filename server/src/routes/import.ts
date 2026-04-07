import type { FastifyInstance } from 'fastify';
import { importAll } from '../services/import.js';

export async function importRoutes(app: FastifyInstance) {
  // Trigger a full scan and import (JSON response, no progress)
  app.post('/api/import/scan', async (_req, reply) => {
    try {
      const result = await importAll();
      return { success: true, data: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      reply.status(500);
      return { success: false, error: message };
    }
  });

  // SSE endpoint for import with real-time progress
  app.get('/api/import/scan/stream', async (_req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await importAll((progress) => {
        send('progress', progress);
      });
      send('done', result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      send('error', { error: message });
    }

    reply.raw.end();
  });
}
