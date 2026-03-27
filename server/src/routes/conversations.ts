import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../db/index.js';
import { resultToObjects } from '../db/utils.js';

export async function conversationRoutes(app: FastifyInstance) {
  // List conversations with filters
  app.get('/api/conversations', async (req) => {
    const {
      source,
      project,
      status,
      search,
      offset = '0',
      limit = '50',
    } = req.query as Record<string, string>;

    const db = getDatabase();
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (source) {
      conditions.push('c.source = ?');
      params.push(source);
    }
    if (project) {
      conditions.push('c.project_name LIKE ?');
      params.push(`%${project}%`);
    }
    if (status) {
      conditions.push('c.status = ?');
      params.push(status);
    }
    if (search) {
      conditions.push('(c.slug LIKE ? OR c.project_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countResult = db.exec(
      `SELECT COUNT(*) FROM conversations c ${where}`,
      params,
    );
    const total = Number(countResult[0]?.values[0]?.[0] ?? 0);

    // Fetch page
    const offsetNum = Number(offset);
    const limitNum = Math.min(Number(limit), 100);
    const dataResult = db.exec(
      `SELECT c.* FROM conversations c ${where}
       ORDER BY c.last_message_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offsetNum],
    );

    const items = resultToObjects(dataResult);

    return {
      success: true,
      data: { items, total, offset: offsetNum, limit: limitNum },
    };
  });

  // Get single conversation with messages
  app.get('/api/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDatabase();

    const convResult = db.exec(
      'SELECT * FROM conversations WHERE id = ?',
      [id],
    );
    if (!convResult.length || !convResult[0].values.length) {
      reply.status(404);
      return { success: false, error: 'Conversation not found' };
    }

    const conversation = resultToObjects(convResult)[0];

    const msgResult = db.exec(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC',
      [id],
    );
    const messages = resultToObjects(msgResult);

    return {
      success: true,
      data: { ...conversation, messages },
    };
  });

  // Delete conversation
  app.delete('/api/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDatabase();

    const existing = db.exec(
      'SELECT id FROM conversations WHERE id = ?',
      [id],
    );
    if (!existing.length || !existing[0].values.length) {
      reply.status(404);
      return { success: false, error: 'Conversation not found' };
    }

    db.run('DELETE FROM conversations WHERE id = ?', [id]);
    return { success: true };
  });
}

