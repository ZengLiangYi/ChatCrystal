import type { FastifyInstance } from 'fastify';
import type { RemoteImportRequest } from '@chatcrystal/shared';
import { isCloudMode } from '../runtime/cloud.js';
import { ingestRemoteImport } from '../services/ingest.js';
import { importAll } from '../services/import.js';

export async function importRoutes(app: FastifyInstance) {
  app.post('/api/import/ingest', async (req, reply) => {
    if (!isCloudMode()) {
      reply.status(400);
      return {
        success: false,
        error: 'Remote import ingest is only available in cloud mode. Use the local import scan endpoint for local servers.',
      };
    }

    const body = req.body as RemoteImportRequest;
    if (!body || body.version !== 1 || !Array.isArray(body.items)) {
      reply.status(400);
      return { success: false, error: 'Invalid remote import payload' };
    }

    try {
      const result = ingestRemoteImport(body);
      return { success: true, data: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Remote import failed';
      reply.status(400);
      return { success: false, error: message };
    }
  });

  // Trigger a full scan and import (JSON response, no progress)
  app.post('/api/import/scan', async (_req, reply) => {
    if (isCloudMode()) {
      reply.status(400);
      return {
        success: false,
        error: 'Server-side import scan is local-only and is disabled in cloud mode. Run crystal import from the device that has the source histories.',
      };
    }

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
    if (isCloudMode()) {
      reply.status(400);
      return {
        success: false,
        error: 'Server-side import scan stream is local-only and is disabled in cloud mode. Run crystal import from the device that has the source histories.',
      };
    }

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
