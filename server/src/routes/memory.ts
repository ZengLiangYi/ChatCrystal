import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { recallForTask } from '../services/memory/recall.js';
import { writeTaskMemory } from '../services/memory/writeback.js';

export async function memoryRoutes(app: FastifyInstance) {
  app.post('/api/memory/recall', async (req, reply) => {
    try {
      const data = await recallForTask(req.body);
      return { success: true, data };
    } catch (error) {
      reply.status(error instanceof ZodError ? 400 : 500);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Invalid recall request',
      };
    }
  });

  app.post('/api/memory/writeback', async (req, reply) => {
    try {
      const data = await writeTaskMemory(req.body);
      return { success: true, data };
    } catch (error) {
      reply.status(error instanceof ZodError ? 400 : 500);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Invalid writeback request',
      };
    }
  });
}
