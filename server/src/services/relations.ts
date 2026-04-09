import { generateObject } from 'ai';
import { z } from 'zod';
import { getDatabase, saveDatabase } from '../db/index.js';
import { resultToObjects } from '../db/utils.js';
import { getLanguageModel } from './llm.js';
import { semanticSearch } from './embedding.js';
import type { RelationType, NoteRelation } from '@chatcrystal/shared';

// =============================================
// Constants
// =============================================

const RelationElementSchema = z.object({
  target_note_id: z.number().describe('目标笔记的 ID'),
  relation_type: z.enum([
    'CAUSED_BY', 'LEADS_TO', 'RESOLVED_BY', 'SIMILAR_TO',
    'CONTRADICTS', 'DEPENDS_ON', 'EXTENDS', 'REFERENCES',
  ]).describe('关系类型'),
  confidence: z.number().min(0).max(1).describe('置信度，0.0-1.0'),
  description: z.string().describe('简短说明关系，20字以内'),
});

const MAX_CANDIDATES = 20;
const MAX_RELATIONS = 5;
const MIN_CONFIDENCE = 0.5;

// =============================================
// System Prompt
// =============================================

const RELATION_SYSTEM_PROMPT = `你是一个知识关联分析助手。给定一个新笔记和一组已有笔记，请分析它们之间有意义的关系。

关系类型说明：
- CAUSED_BY: 新笔记描述的问题/现象是由目标笔记中的内容引起的
- LEADS_TO: 新笔记的内容导致了目标笔记描述的结果
- RESOLVED_BY: 新笔记描述的问题被目标笔记的方案解决
- SIMILAR_TO: 两个笔记讨论类似的主题或技术
- CONTRADICTS: 两个笔记的结论或方案互相矛盾
- DEPENDS_ON: 新笔记的内容依赖于目标笔记的实现
- EXTENDS: 新笔记是对目标笔记内容的扩展或深化
- REFERENCES: 新笔记引用或提及了目标笔记相关的内容

注意：
- 只返回有意义的关系（confidence >= 0.5）
- 最多返回 5 个关系
- 如果没有有意义的关系，返回空数组
- 不要编造不存在的关系`;

// =============================================
// Candidate Discovery
// =============================================

interface CandidateNote {
  id: number;
  title: string;
  summary: string;
  tags: string;
}

async function findCandidateNotes(noteId: number, noteTitle: string): Promise<CandidateNote[]> {
  const db = getDatabase();

  // Try semantic search first for better candidates
  let candidateIds: number[] = [];
  try {
    const searchResults = await semanticSearch(noteTitle, MAX_CANDIDATES);
    candidateIds = searchResults
      .map((r) => r.noteId)
      .filter((id) => id !== noteId);
  } catch {
    // Semantic search not available, fall through to DB fallback
  }

  if (candidateIds.length > 0) {
    // Fetch details for semantically similar notes
    const placeholders = candidateIds.map(() => '?').join(',');
    const result = db.exec(
      `SELECT n.id, n.title, n.summary,
        (SELECT GROUP_CONCAT(t.name) FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id) as tags
       FROM notes n
       WHERE n.id IN (${placeholders})`,
      candidateIds,
    );
    return resultToObjects(result) as unknown as CandidateNote[];
  }

  // Fallback: get most recent notes from DB
  const result = db.exec(
    `SELECT n.id, n.title, n.summary,
      (SELECT GROUP_CONCAT(t.name) FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id) as tags
     FROM notes n
     WHERE n.id != ?
     ORDER BY n.created_at DESC
     LIMIT ?`,
    [noteId, MAX_CANDIDATES],
  );
  return resultToObjects(result) as unknown as CandidateNote[];
}

// =============================================
// Public API
// =============================================

/**
 * Discover relations between a note and existing notes using LLM.
 */
export async function discoverRelations(noteId: number): Promise<NoteRelation[]> {
  const db = getDatabase();

  // Get the source note
  const noteResult = db.exec(
    `SELECT n.id, n.title, n.summary, n.key_conclusions,
      (SELECT GROUP_CONCAT(t.name) FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id) as tags
     FROM notes n WHERE n.id = ?`,
    [noteId],
  );
  if (!noteResult.length || !noteResult[0].values.length) {
    throw new Error('Note not found');
  }
  const note = resultToObjects(noteResult)[0];

  // Find candidate notes
  const candidates = await findCandidateNotes(noteId, note.title as string);
  if (candidates.length === 0) {
    return [];
  }

  // Build prompt
  const candidateList = candidates
    .map((c) => {
      const summary = (c.summary || '').slice(0, 200);
      const tags = c.tags ? ` [${c.tags}]` : '';
      return `[id=${c.id}] "${c.title}" - ${summary}${tags}`;
    })
    .join('\n');

  const prompt = `新笔记：
标题: ${note.title}
摘要: ${(note.summary as string).slice(0, 500)}
标签: ${note.tags || '无'}
关键结论: ${note.key_conclusions || '无'}

已有笔记：
${candidateList}`;

  // Call LLM
  const { object: rawRelations } = await generateObject({
    model: getLanguageModel(),
    output: 'array',
    schema: RelationElementSchema,
    system: RELATION_SYSTEM_PROMPT,
    prompt,
    maxOutputTokens: 1024,
    maxRetries: 2,
  });

  // Filter and persist
  const validRelations: NoteRelation[] = [];
  const candidateIdSet = new Set(candidates.map((c) => c.id));

  for (const rel of rawRelations) {
    if (!candidateIdSet.has(rel.target_note_id)) continue;
    if (rel.confidence < MIN_CONFIDENCE) continue;
    if (validRelations.length >= MAX_RELATIONS) break;

    // Insert into DB
    try {
      db.run(
        `INSERT OR IGNORE INTO note_relations
          (source_note_id, target_note_id, relation_type, confidence, description, created_by)
         VALUES (?, ?, ?, ?, ?, 'llm')`,
        [noteId, rel.target_note_id, rel.relation_type, Math.round(rel.confidence * 100) / 100, rel.description],
      );

      validRelations.push({
        id: 0,
        source_note_id: noteId,
        target_note_id: rel.target_note_id,
        relation_type: rel.relation_type,
        confidence: rel.confidence,
        description: rel.description,
        created_by: 'llm',
        created_at: new Date().toISOString(),
      });
    } catch {
      // UNIQUE constraint violation — relation already exists, skip
    }
  }

  if (validRelations.length > 0) {
    saveDatabase();
  }

  console.log(`[Relations] Discovered ${validRelations.length} relations for note ${noteId}`);
  return validRelations;
}

/**
 * Get all relations for a note (both as source and target).
 */
export function getNoteRelations(noteId: number): NoteRelation[] {
  const db = getDatabase();
  const result = db.exec(
    `SELECT r.*,
      sn.title as source_title,
      tn.title as target_title
     FROM note_relations r
     JOIN notes sn ON sn.id = r.source_note_id
     JOIN notes tn ON tn.id = r.target_note_id
     WHERE r.source_note_id = ? OR r.target_note_id = ?
     ORDER BY r.confidence DESC`,
    [noteId, noteId],
  );
  return resultToObjects(result) as unknown as NoteRelation[];
}

/**
 * Create a manual relation between two notes.
 */
export function createRelation(
  sourceNoteId: number,
  targetNoteId: number,
  relationType: RelationType,
  description?: string,
): NoteRelation {
  const validTypes = RelationElementSchema.shape.relation_type.options;
  if (!validTypes.includes(relationType as typeof validTypes[number])) {
    throw new Error(`Invalid relation type: ${relationType}`);
  }

  const db = getDatabase();

  // Verify both notes exist
  const check = db.exec(
    'SELECT COUNT(*) FROM notes WHERE id IN (?, ?)',
    [sourceNoteId, targetNoteId],
  );
  if (Number(check[0]?.values[0]?.[0]) < 2) {
    throw new Error('One or both notes not found');
  }

  db.run(
    `INSERT INTO note_relations
      (source_note_id, target_note_id, relation_type, confidence, description, created_by)
     VALUES (?, ?, ?, 1.0, ?, 'manual')`,
    [sourceNoteId, targetNoteId, relationType, description || null],
  );

  saveDatabase();

  // Fetch the inserted relation
  const result = db.exec(
    `SELECT r.*, sn.title as source_title, tn.title as target_title
     FROM note_relations r
     JOIN notes sn ON sn.id = r.source_note_id
     JOIN notes tn ON tn.id = r.target_note_id
     WHERE r.source_note_id = ? AND r.target_note_id = ? AND r.relation_type = ?`,
    [sourceNoteId, targetNoteId, relationType],
  );
  return resultToObjects(result)[0] as unknown as NoteRelation;
}

/**
 * Delete a relation by ID.
 */
export function deleteRelation(relationId: number): boolean {
  const db = getDatabase();
  db.run('DELETE FROM note_relations WHERE id = ?', [relationId]);
  const changes = db.getRowsModified();
  if (changes > 0) saveDatabase();
  return changes > 0;
}
