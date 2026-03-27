import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../db/index.js';
import { appConfig } from '../config.js';
import { resultToObjects } from '../db/utils.js';

export async function statusRoutes(app: FastifyInstance) {
  app.get('/api/status', async () => {
    const db = getDatabase();

    const convCount =
      db.exec('SELECT COUNT(*) as c FROM conversations')[0]?.values[0]?.[0] ??
      0;
    const noteCount =
      db.exec('SELECT COUNT(*) as c FROM notes')[0]?.values[0]?.[0] ?? 0;
    const tagCount =
      db.exec('SELECT COUNT(*) as c FROM tags')[0]?.values[0]?.[0] ?? 0;

    // Recent notes
    const recentNotes = resultToObjects(
      db.exec(
        `SELECT n.id, n.title, n.conversation_id, c.project_name, n.created_at
         FROM notes n JOIN conversations c ON c.id = n.conversation_id
         ORDER BY n.created_at DESC LIMIT 5`,
      ),
    );

    return {
      success: true,
      data: {
        server: true,
        database: true,
        stats: {
          totalConversations: convCount,
          totalNotes: noteCount,
          totalTags: tagCount,
        },
        recentNotes,
      },
    };
  });

  // Current config (read-only, no secrets)
  app.get('/api/config', async () => {
    return {
      success: true,
      data: {
        llm: {
          provider: appConfig.llm.provider,
          baseURL: appConfig.llm.baseURL,
          model: appConfig.llm.model,
          hasApiKey: !!appConfig.llm.apiKey,
        },
        embedding: {
          provider: appConfig.embedding.provider,
          baseURL: appConfig.embedding.baseURL,
          model: appConfig.embedding.model,
        },
        claudeProjectsDir: appConfig.claudeProjectsDir,
      },
    };
  });
}
