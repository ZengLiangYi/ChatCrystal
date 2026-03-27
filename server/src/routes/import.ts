import type { FastifyInstance } from 'fastify';
import { importAll } from '../services/import.js';

export async function importRoutes(app: FastifyInstance) {
  // Trigger a full scan and import
  app.post('/api/import/scan', async (_req, reply) => {
    try {
      const result = await importAll((progress) => {
        // For now just log; SSE will be added later
        if (progress.current % 20 === 0) {
          console.log(
            `[Import] ${progress.current}/${progress.total} — ${progress.imported} imported`,
          );
        }
      });

      return {
        success: true,
        data: result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      reply.status(500);
      return { success: false, error: message };
    }
  });
}
