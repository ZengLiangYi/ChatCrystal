import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../db/index.js';
import { resultToObjects } from '../db/utils.js';
import { triggerSummarize, getUnsummarizedIds } from '../services/summarize.js';
import { enqueueWithRetry, getQueueStatus, cancelQueue } from '../queue/index.js';
import { generateEmbeddings, semanticSearch } from '../services/embedding.js';

function hydrateNote(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    key_conclusions: row.key_conclusions ? JSON.parse(row.key_conclusions as string) : [],
    code_snippets: row.code_snippets ? JSON.parse(row.code_snippets as string) : [],
    tags: row.tags_csv ? (row.tags_csv as string).split(',') : [],
    is_edited: Boolean(row.is_edited),
  };
}

export async function noteRoutes(app: FastifyInstance) {
  // Trigger summarization for one conversation
  app.post('/api/conversations/:id/summarize', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDatabase();

    // Get conversation title for tracker
    const convResult = db.exec(
      'SELECT project_name, slug FROM conversations WHERE id = ?',
      [id],
    );
    if (!convResult.length || !convResult[0].values.length) {
      reply.status(404);
      return { success: false, error: 'Conversation not found' };
    }
    const [projectName, slug] = convResult[0].values[0] as [string, string];
    const title = `${projectName} / ${slug || id.slice(0, 8)}`;

    // Fire-and-forget — don't await, let the queue handle it
    enqueueWithRetry(id, title, () => triggerSummarize(id)).catch((err) => {
      console.error(`[Summarize] Error for ${id}:`, err instanceof Error ? err.message : err);
    });

    return {
      success: true,
      data: { queued: 1, queue: getQueueStatus() },
    };
  });

  // Batch summarize all unsummarized conversations
  app.post('/api/summarize/batch', async () => {
    const db = getDatabase();
    const ids = getUnsummarizedIds();
    let queued = 0;

    for (const id of ids) {
      // Get title for tracker
      const r = db.exec('SELECT project_name, slug FROM conversations WHERE id = ?', [id]);
      const [pn, sl] = (r[0]?.values[0] ?? ['', '']) as [string, string];
      const title = `${pn} / ${sl || id.slice(0, 8)}`;

      enqueueWithRetry(id, title, () => triggerSummarize(id)).catch((err) => {
        console.error(`[Summarize] Error for ${id}:`, err instanceof Error ? err.message : err);
      });
      queued++;
    }

    return {
      success: true,
      data: { queued, total: ids.length, queue: getQueueStatus() },
    };
  });

  // Reset error conversations back to 'imported' for retry
  app.post('/api/summarize/reset-errors', async () => {
    const db = getDatabase();
    const result = db.exec("SELECT COUNT(*) FROM conversations WHERE status = 'error'");
    const count = Number(result[0]?.values[0]?.[0] ?? 0);
    db.run("UPDATE conversations SET status = 'imported' WHERE status = 'error'");
    return { success: true, data: { reset: count } };
  });

  // List notes
  app.get('/api/notes', async (req) => {
    const { tag, search, offset = '0', limit = '50' } = req.query as Record<string, string>;
    const db = getDatabase();

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (tag) {
      conditions.push(
        'n.id IN (SELECT nt.note_id FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE t.name = ?)',
      );
      params.push(tag);
    }
    if (search) {
      conditions.push('(n.title LIKE ? OR n.summary LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = db.exec(`SELECT COUNT(*) FROM notes n ${where}`, params);
    const total = Number(countResult[0]?.values[0]?.[0] ?? 0);

    const offsetNum = Number(offset);
    const limitNum = Math.min(Number(limit), 100);

    const dataResult = db.exec(
      `SELECT n.*, c.project_name,
        (SELECT GROUP_CONCAT(t.name) FROM note_tags nt
         JOIN tags t ON t.id = nt.tag_id
         WHERE nt.note_id = n.id) as tags_csv
       FROM notes n
       JOIN conversations c ON c.id = n.conversation_id
       ${where}
       ORDER BY n.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offsetNum],
    );

    const items = resultToObjects(dataResult).map(hydrateNote);

    return {
      success: true,
      data: { items, total, offset: offsetNum, limit: limitNum },
    };
  });

  // Get note ID by conversation ID
  app.get('/api/notes/by-conversation/:conversationId', async (req, reply) => {
    const { conversationId } = req.params as { conversationId: string };
    const db = getDatabase();
    const result = db.exec(
      'SELECT id FROM notes WHERE conversation_id = ?',
      [conversationId],
    );
    if (!result.length || !result[0].values.length) {
      reply.status(404);
      return { success: false, error: 'Note not found for this conversation' };
    }
    const noteId = Number(result[0].values[0][0]);
    return { success: true, data: { id: noteId } };
  });

  // Get single note
  app.get('/api/notes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDatabase();

    const result = db.exec(
      `SELECT n.*, c.project_name, c.project_dir,
        (SELECT GROUP_CONCAT(t.name) FROM note_tags nt
         JOIN tags t ON t.id = nt.tag_id
         WHERE nt.note_id = n.id) as tags_csv
       FROM notes n
       JOIN conversations c ON c.id = n.conversation_id
       WHERE n.id = ?`,
      [Number(id)],
    );

    if (!result.length || !result[0].values.length) {
      reply.status(404);
      return { success: false, error: 'Note not found' };
    }

    const note = hydrateNote(resultToObjects(result)[0]);

    return { success: true, data: note };
  });

  // List tags with counts
  app.get('/api/tags', async () => {
    const db = getDatabase();
    const result = db.exec(
      `SELECT t.id, t.name, COUNT(nt.note_id) as count
       FROM tags t
       LEFT JOIN note_tags nt ON nt.tag_id = t.id
       GROUP BY t.id
       ORDER BY count DESC`,
    );

    return { success: true, data: resultToObjects(result) };
  });

  // Queue status
  app.get('/api/queue/status', async () => {
    return { success: true, data: getQueueStatus() };
  });

  // SSE endpoint for real-time queue status
  app.get('/api/queue/stream', async (_req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const interval = setInterval(() => {
      const snapshot = getQueueStatus();

      const tasks = snapshot.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        error: t.error,
        duration: t.finishedAt && t.startedAt ? t.finishedAt - t.startedAt : undefined,
      }));

      send('status', {
        total: snapshot.total,
        completed: snapshot.completed,
        failed: snapshot.failed,
        active: snapshot.active,
        tasks,
      });

      const hasWork = snapshot.tasks.some(
        (t) => t.status === 'queued' || t.status === 'processing',
      );
      if (snapshot.total > 0 && !hasWork) {
        send('done', {
          total: snapshot.total,
          completed: snapshot.completed,
          failed: snapshot.failed,
        });
        clearInterval(interval);
        reply.raw.end();
      }
    }, 1000);

    _req.raw.on('close', () => {
      clearInterval(interval);
    });
  });

  // Cancel queued tasks
  app.post('/api/queue/cancel', async () => {
    const result = cancelQueue();
    return { success: true, data: result };
  });

  // Semantic search
  app.get('/api/search', async (req, reply) => {
    const { q, limit = '10', expand } = req.query as Record<string, string>;
    if (!q?.trim()) {
      reply.status(400);
      return { success: false, error: 'Query parameter "q" is required' };
    }

    try {
      const results = await semanticSearch(q, Math.min(Number(limit), 50), expand === 'true');

      // Enrich results with tags from DB
      const db = getDatabase();
      const enriched = results.map((r) => {
        const tagResult = db.exec(
          `SELECT GROUP_CONCAT(t.name) as tags_csv
           FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
           WHERE nt.note_id = ?`,
          [r.noteId],
        );
        const tagsCsv = tagResult[0]?.values[0]?.[0] as string | null;
        return {
          note_id: r.noteId,
          conversation_id: r.conversationId,
          title: r.title,
          project_name: r.projectName,
          score: Math.round(r.score * 1000) / 1000,
          tags: tagsCsv ? tagsCsv.split(',') : [],
          via_relation: r.viaRelation || null,
        };
      });

      return { success: true, data: enriched };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed';
      reply.status(500);
      return { success: false, error: message };
    }
  });

  // Generate embeddings for a note
  app.post('/api/notes/:id/embed', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const chunks = await generateEmbeddings(Number(id));
      return { success: true, data: { noteId: Number(id), chunks } };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Embedding failed';
      reply.status(500);
      return { success: false, error: message };
    }
  });

  // Batch generate embeddings for all notes without embeddings
  app.post('/api/embeddings/batch', async () => {
    const db = getDatabase();
    const result = db.exec(
      `SELECT n.id FROM notes n
       WHERE n.embedding_status IN ('pending', 'failed')`,
    );
    if (!result.length || !result[0].values.length) {
      return { success: true, data: { queued: 0 } };
    }

    const noteIds = result[0].values.map((r) => Number(r[0]));
    for (const noteId of noteIds) {
      enqueueWithRetry(`embed-${noteId}`, `Embedding #${noteId}`, () => generateEmbeddings(noteId)).catch((err) => {
        console.error(`[Embedding] Error for note ${noteId}:`, err instanceof Error ? err.message : err);
      });
    }

    return { success: true, data: { queued: noteIds.length, queue: getQueueStatus() } };
  });
}
