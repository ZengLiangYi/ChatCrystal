import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RemoteImportRequest } from '@chatcrystal/shared';
import { isCloudMode } from '../runtime/cloud.js';
import {
  type HeaderValue,
  isLocalBrowserRequestOriginAllowed,
} from '../runtime/localOrigin.js';
import { ingestRemoteImport } from '../services/ingest.js';
import { importAll } from '../services/import.js';

export function isLocalImportRequestOriginAllowed(origin: HeaderValue, referer: HeaderValue): boolean {
  return isLocalBrowserRequestOriginAllowed(origin, referer);
}

function rejectNonLocalImportOrigin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!isLocalImportRequestOriginAllowed(req.headers.origin, req.headers.referer)) {
    reply.status(403).send({ success: false, error: 'Local import must be started from ChatCrystal.' });
    return true;
  }

  return false;
}

function requestedSources(body: unknown): string[] | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = (body as { sources?: unknown }).sources;
  if (!Array.isArray(value)) return undefined;
  const sources = value.filter(
    (item): item is string => typeof item === 'string' && item.length > 0,
  );
  return sources.length > 0 ? sources : undefined;
}

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
  app.post('/api/import/scan', async (req, reply) => {
    if (isCloudMode()) {
      reply.status(400);
      return {
        success: false,
        error: 'Server-side import scan is local-only and is disabled in cloud mode. Run crystal import from the device that has the source histories.',
      };
    }
    if (rejectNonLocalImportOrigin(req, reply)) return;

    try {
      const result = await importAll({ sources: requestedSources(req.body) });
      return { success: true, data: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      reply.status(500);
      return { success: false, error: message };
    }
  });

  // SSE endpoint for import with real-time progress
  app.post('/api/import/scan/stream', async (req, reply) => {
    if (isCloudMode()) {
      reply.status(400);
      return {
        success: false,
        error: 'Server-side import scan stream is local-only and is disabled in cloud mode. Run crystal import from the device that has the source histories.',
      };
    }
    if (rejectNonLocalImportOrigin(req, reply)) return;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const controller = new AbortController();
    let closed = false;
    const closeHandler = () => {
      closed = true;
      controller.abort();
    };
    reply.raw.on('close', closeHandler);

    const send = (event: string, data: unknown) => {
      if (closed) return;
      try {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        closed = true;
        controller.abort();
      }
    };

    const heartbeat = setInterval(() => {
      if (closed) return;
      try {
        reply.raw.write(': heartbeat\n\n');
      } catch {
        closed = true;
        controller.abort();
      }
    }, 15_000);

    try {
      const result = await importAll({
        sources: requestedSources(req.body),
        signal: controller.signal,
        onProgress: (progress) => {
          send('progress', progress);
        },
      });
      send('done', result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      send('error', { error: message });
    } finally {
      clearInterval(heartbeat);
      reply.raw.off('close', closeHandler);
      if (!closed) reply.raw.end();
    }
  });
}
