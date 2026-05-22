import type { FastifyInstance } from 'fastify';
import { isCloudMode } from '../runtime/cloud.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({
    success: true,
    data: {
      ok: true,
      cloudMode: isCloudMode(),
    },
  }));
}
