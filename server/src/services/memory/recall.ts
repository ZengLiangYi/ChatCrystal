import type {
  RecallForTaskResponse,
  RecallMemoryItem,
} from '@chatcrystal/shared';
import { getDatabase } from '../../db/index.js';
import { semanticSearch } from '../embedding.js';
import { parseRecallForTaskRequest } from './schemas.js';
import {
  deriveProjectKey,
  expandProjectKeyAliases,
  resolveProjectIdentity,
  resolveCanonicalProjectKey,
} from './projectKey.js';

function safeParseMemoryPayload(input: unknown) {
  if (typeof input !== 'string' || !input.trim()) return {};
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function asStringArray(input: unknown) {
  return Array.isArray(input) ? input.map(String) : [];
}

export async function recallForTask(
  input: unknown,
  deps: {
    db?: Pick<ReturnType<typeof getDatabase>, 'exec'>;
    semanticSearch?: typeof semanticSearch;
  } = {},
): Promise<RecallForTaskResponse> {
  const request = parseRecallForTaskRequest(input);
  const db = deps.db ?? getDatabase();
  const search = deps.semanticSearch ?? semanticSearch;
  const projectLimit = request.options?.project_limit ?? 5;
  const globalLimit = request.options?.global_limit ?? 3;
  const includeRelations = request.options?.include_relations ?? true;
  const warnings: string[] = [];

  const candidateProjectKey = request.task.project_key
    ? request.task.project_key
    : (() => {
        try {
          return deriveProjectKey(
            resolveProjectIdentity({
              projectDir: request.task.project_dir,
              cwd: request.task.cwd,
            }),
          );
        } catch {
          return undefined;
        }
      })();
  const canonicalProjectKey = resolveCanonicalProjectKey(db, candidateProjectKey);
  const projectKeys = canonicalProjectKey
    ? expandProjectKeyAliases(db, canonicalProjectKey)
    : new Set<string>();

  if (!canonicalProjectKey) {
    warnings.push(
      'No project identity was available; returning only global matches.',
    );
  }

  const hits = await search(
    [request.task.goal, ...(request.task.error_signatures ?? [])]
      .filter(Boolean)
      .join('\n'),
    Math.max((projectLimit + globalLimit) * 3, 1),
    includeRelations,
  );
  const noteIds = [...new Set(hits.map((hit) => hit.noteId))];

  if (noteIds.length === 0) {
    return {
      mode: request.mode,
      project_key: canonicalProjectKey,
      reason: canonicalProjectKey ? 'no-matches' : 'no-project-key',
      warnings,
      project_memories: [],
      global_memories: [],
    };
  }

  const placeholders = noteIds.map(() => '?').join(',');
  const metadata = db.exec(
    `SELECT id, title, summary, project_key, scope, outcome_type, raw_llm_response
       FROM notes
      WHERE id IN (${placeholders})`,
    noteIds,
  );
  const relationRows = db.exec(
    `SELECT source_note_id, target_note_id
       FROM note_relations
      WHERE source_note_id IN (${placeholders}) OR target_note_id IN (${placeholders})`,
    [...noteIds, ...noteIds],
  );

  const relatedNoteIds = new Map<number, number[]>();
  for (const row of relationRows[0]?.values ?? []) {
    const sourceId = Number(row[0]);
    const targetId = Number(row[1]);
    relatedNoteIds.set(sourceId, [
      ...(relatedNoteIds.get(sourceId) ?? []),
      targetId,
    ]);
    relatedNoteIds.set(targetId, [
      ...(relatedNoteIds.get(targetId) ?? []),
      sourceId,
    ]);
  }

  const metaMap = new Map(
    (metadata[0]?.values ?? []).map((row) => [
      Number(row[0]),
      {
        title: String(row[1] ?? ''),
        summary: String(row[2] ?? ''),
        project_key: row[3] ? String(row[3]) : '',
        scope: row[4] ? String(row[4]) : 'project',
        outcome_type: row[5] ? String(row[5]) : undefined,
        payload: safeParseMemoryPayload(row[6]),
      },
    ]),
  );

  const projectMemories: RecallMemoryItem[] = [];
  const globalMemories: RecallMemoryItem[] = [];

  for (const hit of hits) {
    const meta = metaMap.get(hit.noteId);
    if (!meta) continue;

    const item: RecallMemoryItem = {
      note_id: hit.noteId,
      title: meta.title || hit.title,
      summary: meta.summary || hit.chunkText,
      outcome_type: meta.outcome_type as RecallMemoryItem['outcome_type'],
      pitfalls: asStringArray(meta.payload.pitfalls),
      reusable_patterns: asStringArray(meta.payload.reusable_patterns),
      related_note_ids: relatedNoteIds.get(hit.noteId) ?? [],
      score: hit.score,
      why_relevant: hit.viaRelation
        ? `Matched via relation ${hit.viaRelation}`
        : 'Matched by semantic similarity',
    };

    if (meta.scope === 'project' && projectKeys.has(meta.project_key)) {
      projectMemories.push(item);
      continue;
    }
    if (meta.scope === 'global') {
      globalMemories.push(item);
    }
  }

  const limitedProjectMemories = projectMemories.slice(0, projectLimit);
  const limitedGlobalMemories = globalMemories.slice(0, globalLimit);
  const reason =
    !canonicalProjectKey
      ? 'no-project-key'
      : limitedProjectMemories.length > 0 || limitedGlobalMemories.length > 0
        ? 'ok'
        : 'no-matches';

  return {
    mode: request.mode,
    project_key: canonicalProjectKey,
    reason,
    warnings,
    project_memories: limitedProjectMemories,
    global_memories: limitedGlobalMemories,
  };
}
