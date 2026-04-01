import type { FastifyInstance } from 'fastify';
import type { RelationType } from '@chatcrystal/shared';
import {
  getNoteRelations,
  createRelation,
  deleteRelation,
  discoverRelations,
} from '../services/relations.js';
import { enqueueWithRetry, getQueueStatus } from '../queue/index.js';
import { getDatabase } from '../db/index.js';
import { resultToObjects } from '../db/utils.js';

export async function relationRoutes(app: FastifyInstance) {
  // Get all relations for a note
  app.get('/api/notes/:id/relations', async (req, reply) => {
    const { id } = req.params as { id: string };
    const noteId = Number(id);
    if (!noteId) {
      reply.status(400);
      return { success: false, error: 'Invalid note ID' };
    }

    const relations = getNoteRelations(noteId);
    return { success: true, data: relations };
  });

  // Create a manual relation
  app.post('/api/notes/:id/relations', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { target_note_id, relation_type, description } = req.body as {
      target_note_id: number;
      relation_type: RelationType;
      description?: string;
    };

    const sourceNoteId = Number(id);
    if (!sourceNoteId || !target_note_id || !relation_type) {
      reply.status(400);
      return { success: false, error: 'Missing required fields: target_note_id, relation_type' };
    }

    if (sourceNoteId === target_note_id) {
      reply.status(400);
      return { success: false, error: 'Cannot create relation to self' };
    }

    try {
      const relation = createRelation(sourceNoteId, target_note_id, relation_type, description);
      return { success: true, data: relation };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create relation';
      reply.status(400);
      return { success: false, error: message };
    }
  });

  // Delete a relation
  app.delete('/api/relations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = deleteRelation(Number(id));
    if (!deleted) {
      reply.status(404);
      return { success: false, error: 'Relation not found' };
    }
    return { success: true };
  });

  // Manually trigger relation discovery for a note
  app.post('/api/notes/:id/discover-relations', async (req, reply) => {
    const { id } = req.params as { id: string };
    const noteId = Number(id);
    if (!noteId) {
      reply.status(400);
      return { success: false, error: 'Invalid note ID' };
    }

    try {
      const relations = await discoverRelations(noteId);
      return { success: true, data: relations };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Discovery failed';
      reply.status(500);
      return { success: false, error: message };
    }
  });

  // Graph data: all notes + relations for visualization
  app.get('/api/relations/graph', async (req) => {
    const { project } = req.query as Record<string, string>;
    const db = getDatabase();

    // Get nodes
    const projectFilter = project ? 'WHERE c.project_name = ?' : '';
    const projectParams = project ? [project] : [];

    const nodesResult = db.exec(
      `SELECT n.id, n.title, c.project_name,
        (SELECT GROUP_CONCAT(t.name) FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id) as tags
       FROM notes n
       JOIN conversations c ON c.id = n.conversation_id
       ${projectFilter}`,
      projectParams,
    );
    const nodes = resultToObjects(nodesResult).map((n) => ({
      id: Number(n.id),
      title: n.title as string,
      project_name: n.project_name as string,
      tags: n.tags ? (n.tags as string).split(',') : [],
    }));

    // Get edges (only between nodes in the result set)
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edgesResult = db.exec(
      `SELECT source_note_id, target_note_id, relation_type, confidence
       FROM note_relations`,
    );
    const edges = resultToObjects(edgesResult)
      .filter((e) => nodeIds.has(Number(e.source_note_id)) && nodeIds.has(Number(e.target_note_id)))
      .map((e) => ({
        source: Number(e.source_note_id),
        target: Number(e.target_note_id),
        type: e.relation_type as string,
        confidence: Number(e.confidence),
      }));

    return { success: true, data: { nodes, edges } };
  });

  // Batch discover relations for all notes without relations
  app.post('/api/relations/batch-discover', async () => {
    const db = getDatabase();
    const result = db.exec(
      `SELECT n.id, n.title FROM notes n
       WHERE n.id NOT IN (SELECT DISTINCT source_note_id FROM note_relations)`,
    );

    if (!result.length || !result[0].values.length) {
      return { success: true, data: { queued: 0 } };
    }

    const notes = result[0].values;
    for (const [noteId, title] of notes) {
      enqueueWithRetry(
        `relations-${noteId}`,
        `Relations: ${title}`,
        () => discoverRelations(Number(noteId)),
      ).catch((err) => {
        console.error(`[Relations] Error for note ${noteId}:`, err instanceof Error ? err.message : err);
      });
    }

    return {
      success: true,
      data: { queued: notes.length, queue: getQueueStatus() },
    };
  });
}
