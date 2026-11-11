import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../db/index.js';
import { resultToObjects } from '../db/utils.js';
import { materializeConversationById } from '../services/import.js';

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
    const conditions: string[] = ["c.source != 'chatcrystal-memory'"];
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

    const loadConversation = () => {
      const convResult = db.exec('SELECT * FROM conversations WHERE id = ?', [
        id,
      ]);
      if (!convResult.length || !convResult[0].values.length) return null;
      const messageResult = db.exec(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC',
        [id],
      );
      return {
        conversation: resultToObjects(convResult)[0],
        messages: resultToObjects(messageResult),
      };
    };

    let loaded = loadConversation();
    if (!loaded) {
      reply.status(404);
      return { success: false, error: 'Conversation not found' };
    }

    // Index-first syncs can leave a conversation without its transcript; parse it
    // now (through the transcript cache / worker pool) instead of showing an
    // empty conversation.
    if (
      loaded.conversation.transcript_status &&
      loaded.conversation.transcript_status !== 'materialized'
    ) {
      const materialized = await materializeConversationById(id);
      if (materialized === 'error') {
        reply.status(500);
        return {
          success: false,
          error: 'Failed to load the conversation transcript',
        };
      }
      loaded = loadConversation();
      if (!loaded) {
        reply.status(404);
        return { success: false, error: 'Conversation not found' };
      }
    }

    return {
      success: true,
      data: { ...loaded.conversation, messages: loaded.messages },
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
