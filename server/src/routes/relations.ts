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

const NOTE_GRAPH_PROJECTION_DEFAULT_LIMIT = 600;
const NOTE_GRAPH_PROJECTION_MAX_LIMIT = 1000;
const TAG_GRAPH_PROJECTION_DEFAULT_LIMIT = 120;
const TAG_GRAPH_PROJECTION_MAX_LIMIT = 300;
const TAG_GRAPH_PROJECTION_DEFAULT_MIN_SCORE = 0.12;
const GRAPH_PROJECTION_RELATION_TYPES = new Set([
  'CAUSED_BY',
  'LEADS_TO',
  'RESOLVED_BY',
  'SIMILAR_TO',
  'CONTRADICTS',
  'DEPENDS_ON',
  'EXTENDS',
  'REFERENCES',
]);

function clampGraphLimit(value: string | undefined, defaultLimit: number, maxLimit: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultLimit;
  return Math.max(1, Math.min(maxLimit, Math.floor(parsed)));
}

function clampMinConfidence(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.5;
  return Math.max(0, Math.min(1, parsed));
}

function clampMinScore(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return TAG_GRAPH_PROJECTION_DEFAULT_MIN_SCORE;
  return Math.max(0, Math.min(1, parsed));
}

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

  app.get('/api/graph/projection', async (req, reply) => {
    const {
      level = 'note',
      limit: limitQuery,
      relationType,
      project,
      minConfidence: minConfidenceQuery,
      minScore: minScoreQuery,
    } = req.query as Record<string, string | undefined>;

    if (level !== 'note' && level !== 'tag') {
      reply.status(400);
      return { success: false, error: `Unsupported graph projection level: ${level}` };
    }

    const db = getDatabase();

    if (level === 'tag') {
      const limit = clampGraphLimit(
        limitQuery,
        TAG_GRAPH_PROJECTION_DEFAULT_LIMIT,
        TAG_GRAPH_PROJECTION_MAX_LIMIT,
      );
      const minScore = clampMinScore(minScoreQuery);
      const tagParams = project ? [project] : [];
      const tagResult = db.exec(
        `SELECT t.id, t.name,
          COUNT(DISTINCT n.id) as note_count,
          COUNT(DISTINCT c.project_name) as project_count
         FROM tags t
         JOIN note_tags nt ON nt.tag_id = t.id
         JOIN notes n ON n.id = nt.note_id
         JOIN conversations c ON c.id = n.conversation_id
         ${project ? 'WHERE c.project_name = ?' : ''}
         GROUP BY t.id, t.name
         ORDER BY note_count DESC, t.name ASC`,
        tagParams,
      );

      const allTags = resultToObjects(tagResult).map((tag) => ({
        id: Number(tag.id),
        kind: 'tag' as const,
        name: String(tag.name ?? ''),
        title: String(tag.name ?? ''),
        note_count: Number(tag.note_count ?? 0),
        degree: 0,
        project_count: Number(tag.project_count ?? 0),
      }));

      const visibleTags = allTags.slice(0, limit);
      const visibleTagIds = visibleTags.map((tag) => tag.id);
      const tagById = new Map(visibleTags.map((tag) => [tag.id, tag]));

      const visibleEdges: Array<{
        id: string;
        source: number;
        target: number;
        type: 'CO_OCCURS_WITH';
        cooccurrence_count: number;
        score: number;
      }> = [];

      if (visibleTagIds.length > 1) {
        const placeholders = visibleTagIds.map(() => '?').join(', ');
        const pairParams: Array<string | number> = [
          ...visibleTagIds,
          ...visibleTagIds,
          ...(project ? [project] : []),
        ];
        const pairResult = db.exec(
          `SELECT nt1.tag_id as left_tag_id,
            nt2.tag_id as right_tag_id,
            COUNT(DISTINCT nt1.note_id) as cooccurrence_count
           FROM note_tags nt1
           JOIN note_tags nt2 ON nt2.note_id = nt1.note_id AND nt1.tag_id < nt2.tag_id
           JOIN notes n ON n.id = nt1.note_id
           JOIN conversations c ON c.id = n.conversation_id
           WHERE nt1.tag_id IN (${placeholders})
             AND nt2.tag_id IN (${placeholders})
             ${project ? 'AND c.project_name = ?' : ''}
           GROUP BY nt1.tag_id, nt2.tag_id`,
          pairParams,
        );

        const rankedEdges = resultToObjects(pairResult)
          .map((row) => {
            const leftTag = tagById.get(Number(row.left_tag_id));
            const rightTag = tagById.get(Number(row.right_tag_id));
            if (!leftTag || !rightTag) return null;

            const cooccurrenceCount = Number(row.cooccurrence_count ?? 0);
            const score = cooccurrenceCount / Math.sqrt(leftTag.note_count * rightTag.note_count);
            if (!Number.isFinite(score) || score < minScore) return null;

            const [sourceTag, targetTag] = leftTag.name.localeCompare(rightTag.name) <= 0
              ? [leftTag, rightTag]
              : [rightTag, leftTag];

            return {
              id: `tag:${sourceTag.id}:${targetTag.id}`,
              source: sourceTag.id,
              target: targetTag.id,
              sourceName: sourceTag.name,
              targetName: targetTag.name,
              type: 'CO_OCCURS_WITH' as const,
              cooccurrence_count: cooccurrenceCount,
              score: Number(score.toFixed(6)),
            };
          })
          .filter((edge): edge is NonNullable<typeof edge> => edge !== null)
          .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            if (right.cooccurrence_count !== left.cooccurrence_count) {
              return right.cooccurrence_count - left.cooccurrence_count;
            }
            const sourceCompare = left.sourceName.localeCompare(right.sourceName);
            if (sourceCompare !== 0) return sourceCompare;
            return left.targetName.localeCompare(right.targetName);
          });

        visibleEdges.push(...rankedEdges.map(({ sourceName: _sourceName, targetName: _targetName, ...edge }) => edge));
      }

      const degreeByTagId = new Map<number, number>();
      for (const edge of visibleEdges) {
        degreeByTagId.set(edge.source, (degreeByTagId.get(edge.source) ?? 0) + 1);
        degreeByTagId.set(edge.target, (degreeByTagId.get(edge.target) ?? 0) + 1);
      }

      const visibleNodes = visibleTags.map((tag) => ({
        ...tag,
        degree: degreeByTagId.get(tag.id) ?? 0,
      }));

      return {
        success: true,
        data: {
          nodes: visibleNodes,
          edges: visibleEdges,
          stats: {
            totalNodes: allTags.length,
            totalEdges: visibleEdges.length,
            visibleNodes: visibleNodes.length,
            visibleEdges: visibleEdges.length,
            limit,
            minScore,
          },
          truncated: allTags.length > visibleNodes.length,
        },
      };
    }

    if (relationType && !GRAPH_PROJECTION_RELATION_TYPES.has(relationType)) {
      reply.status(400);
      return { success: false, error: `Invalid relation type: ${relationType}` };
    }

    const limit = clampGraphLimit(
      limitQuery,
      NOTE_GRAPH_PROJECTION_DEFAULT_LIMIT,
      NOTE_GRAPH_PROJECTION_MAX_LIMIT,
    );
    const minConfidence = clampMinConfidence(minConfidenceQuery);

    const nodeParams = project ? [project] : [];
    const nodeResult = db.exec(
      `SELECT n.id, n.title, c.project_name,
        n.source_type, n.outcome_type, n.task_kind, n.created_at,
        (SELECT GROUP_CONCAT(t.name) FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id) as tags
       FROM notes n
       JOIN conversations c ON c.id = n.conversation_id
       ${project ? 'WHERE c.project_name = ?' : ''}`,
      nodeParams,
    );
    const allNodes = resultToObjects(nodeResult).map((node) => ({
      id: Number(node.id),
      kind: 'note' as const,
      title: String(node.title ?? ''),
      project_name: String(node.project_name ?? ''),
      tags: node.tags ? String(node.tags).split(',') : [],
      degree: 0,
      source_type: node.source_type ? String(node.source_type) : null,
      outcome_type: node.outcome_type ? String(node.outcome_type) : null,
      task_kind: node.task_kind ? String(node.task_kind) : null,
      created_at: String(node.created_at ?? ''),
    }));
    const scopedNodeIds = new Set(allNodes.map((node) => node.id));

    const edgeWhere = ['confidence >= ?'];
    const edgeParams: Array<string | number> = [minConfidence];
    if (relationType) {
      edgeWhere.push('relation_type = ?');
      edgeParams.push(relationType);
    }
    const edgeResult = db.exec(
      `SELECT id, source_note_id, target_note_id, relation_type, confidence, description, created_by
       FROM note_relations
       WHERE ${edgeWhere.join(' AND ')}`,
      edgeParams,
    );
    const scopedEdges = resultToObjects(edgeResult)
      .map((edge) => ({
        id: Number(edge.id),
        source: Number(edge.source_note_id),
        target: Number(edge.target_note_id),
        type: String(edge.relation_type ?? ''),
        confidence: Number(edge.confidence),
        description: edge.description == null ? null : String(edge.description),
        created_by: String(edge.created_by ?? 'manual'),
      }))
      .filter((edge) => scopedNodeIds.has(edge.source) && scopedNodeIds.has(edge.target));

    const degreeByNodeId = new Map<number, number>();
    for (const edge of scopedEdges) {
      degreeByNodeId.set(edge.source, (degreeByNodeId.get(edge.source) ?? 0) + 1);
      degreeByNodeId.set(edge.target, (degreeByNodeId.get(edge.target) ?? 0) + 1);
    }

    const rankedNodes = allNodes
      .map((node) => ({
        ...node,
        degree: degreeByNodeId.get(node.id) ?? 0,
      }))
      .sort((left, right) => {
        if (right.degree !== left.degree) return right.degree - left.degree;
        const rightTime = Date.parse(right.created_at);
        const leftTime = Date.parse(left.created_at);
        if (rightTime !== leftTime) return rightTime - leftTime;
        return left.id - right.id;
      });

    const visibleNodes = rankedNodes.slice(0, limit).map(({ created_at: _createdAt, ...node }) => node);
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const visibleEdges = scopedEdges.filter(
      (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
    );

    return {
      success: true,
      data: {
        nodes: visibleNodes,
        edges: visibleEdges,
        stats: {
          totalNodes: allNodes.length,
          totalEdges: scopedEdges.length,
          visibleNodes: visibleNodes.length,
          visibleEdges: visibleEdges.length,
          limit,
          minConfidence,
        },
        truncated: allNodes.length > visibleNodes.length,
      },
    };
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
