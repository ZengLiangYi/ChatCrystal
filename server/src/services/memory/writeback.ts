import type { WriteTaskMemoryResponse } from '@chatcrystal/shared';
import { getDatabase } from '../../db/index.js';
import { withTransaction } from '../../db/transaction.js';
import { generateEmbeddings, semanticSearch } from '../embedding.js';
import { decideWritebackAction } from './decision.js';
import { ensureSyntheticOriginConversation } from './origin.js';
import { deriveProjectKey, resolveCanonicalProjectKey, resolveProjectIdentity } from './projectKey.js';
import { parseWriteTaskMemoryRequest } from './schemas.js';

function safeParseObject(input: unknown): Record<string, unknown> {
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

function safeParseStringArray(input: unknown): string[] {
  if (typeof input !== 'string' || !input.trim()) return [];
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function normalizeTags(tags?: string[]) {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

function mergeStringArrays(left: unknown, right: unknown) {
  return [...new Set([...safeParseStringArray(JSON.stringify(left ?? [])), ...safeParseStringArray(JSON.stringify(right ?? []))])];
}

function mergeCodeSnippets(
  left: unknown,
  right: unknown,
): Array<Record<string, unknown>> | undefined {
  const leftSnippets = Array.isArray(left)
    ? left.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'))
    : [];
  const rightSnippets = Array.isArray(right)
    ? right.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'))
    : [];
  const merged = new Map<string, Record<string, unknown>>();
  for (const snippet of [...leftSnippets, ...rightSnippets]) {
    merged.set(JSON.stringify(snippet), snippet);
  }
  return merged.size > 0 ? [...merged.values()] : undefined;
}

function safeParseArray<T extends Record<string, unknown>>(input: unknown) {
  if (typeof input !== 'string' || !input.trim()) return [] as T[];
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed)
      ? parsed.filter(
          (value): value is T => Boolean(value && typeof value === 'object'),
        )
      : [];
  } catch {
    return [] as T[];
  }
}

function mergeMemoryPayload(
  existingRaw: unknown,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const existing = typeof existingRaw === 'object' && existingRaw !== null
    ? (existingRaw as Record<string, unknown>)
    : {};

  return {
    ...existing,
    ...incoming,
    root_cause:
      typeof incoming.root_cause === 'string' && incoming.root_cause.trim()
        ? incoming.root_cause
        : existing.root_cause,
    resolution:
      typeof incoming.resolution === 'string' && incoming.resolution.trim()
        ? incoming.resolution
        : existing.resolution,
    pitfalls: mergeStringArrays(existing.pitfalls, incoming.pitfalls),
    reusable_patterns: mergeStringArrays(
      existing.reusable_patterns,
      incoming.reusable_patterns,
    ),
    decisions: mergeStringArrays(existing.decisions, incoming.decisions),
    key_conclusions: mergeStringArrays(
      existing.key_conclusions,
      incoming.key_conclusions,
    ),
    files_touched: mergeStringArrays(
      existing.files_touched,
      incoming.files_touched,
    ),
    error_signatures: mergeStringArrays(
      existing.error_signatures,
      incoming.error_signatures,
    ),
    tags: normalizeTags([
      ...safeParseStringArray(JSON.stringify(existing.tags ?? [])),
      ...safeParseStringArray(JSON.stringify(incoming.tags ?? [])),
    ]),
    code_snippets: mergeCodeSnippets(existing.code_snippets, incoming.code_snippets),
  };
}

function upsertNoteTags(
  db: ReturnType<typeof getDatabase>,
  noteId: number,
  tags?: string[],
) {
  for (const tagName of normalizeTags(tags)) {
    db.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', [tagName]);
    const tagResult = db.exec('SELECT id FROM tags WHERE name = ?', [tagName]);
    const tagId = Number(tagResult[0]?.values[0]?.[0]);
    db.run('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)', [
      noteId,
      tagId,
    ]);
  }
}

function upsertRelatedMemoryRelations(
  db: ReturnType<typeof getDatabase>,
  noteId: number,
  relatedNoteIds: number[],
) {
  for (const relatedNoteId of relatedNoteIds) {
    if (relatedNoteId === noteId) continue;
    db.run(
      `INSERT OR IGNORE INTO note_relations (source_note_id, target_note_id, relation_type, confidence, created_by)
       VALUES (?, ?, 'SIMILAR_TO', 0.75, 'llm')`,
      [noteId, relatedNoteId],
    );
  }
}

export async function writeTaskMemory(
  input: unknown,
  deps: {
    db?: ReturnType<typeof getDatabase>;
    semanticSearch?: typeof semanticSearch;
    generateEmbeddings?: typeof generateEmbeddings;
  } = {},
): Promise<WriteTaskMemoryResponse> {
  const request = parseWriteTaskMemoryRequest(input);
  const db = deps.db ?? getDatabase();
  const search = deps.semanticSearch ?? semanticSearch;
  const embedNote = deps.generateEmbeddings ?? generateEmbeddings;
  const normalizedAgent = request.task.source_agent;
  const normalizedScope =
    request.mode === 'manual' ? request.scope ?? 'project' : 'project';

  const resolvedProjectKey = request.task.project_key
    ? resolveCanonicalProjectKey(db, request.task.project_key)
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

  if (request.mode === 'auto') {
    const sourceRunKey = request.source_run_key ?? null;
    const existingReceipt = db.exec(
      `SELECT decision, note_id, merged_into_note_id, reason, index_status
         FROM writeback_receipts
        WHERE source_agent = ? AND source_run_key = ?`,
      [normalizedAgent, sourceRunKey],
    );
    if (existingReceipt[0]?.values.length) {
      const [decision, noteId, mergedIntoNoteId, reason, indexStatus] =
        existingReceipt[0].values[0];
      const replayTargetId = noteId
        ? Number(noteId)
        : mergedIntoNoteId
          ? Number(mergedIntoNoteId)
          : null;

      if (String(indexStatus) === 'pending' && replayTargetId) {
        await embedNote(replayTargetId);
        db.run(
          `UPDATE writeback_receipts
              SET index_status = 'completed'
            WHERE source_agent = ? AND source_run_key = ?`,
          [normalizedAgent, sourceRunKey],
        );
      }

      return {
        mode: request.mode,
        decision: String(decision) as WriteTaskMemoryResponse['decision'],
        note_id: noteId ? Number(noteId) : null,
        merged_into_note_id: mergedIntoNoteId ? Number(mergedIntoNoteId) : null,
        reason: String(reason),
        warnings: [],
      };
    }
  }

  const candidates = await search(
    [
      request.task.goal,
      request.memory.summary,
      request.memory.root_cause,
      request.memory.resolution,
      ...(request.memory.error_signatures ?? []),
    ]
      .filter(Boolean)
      .join('\n'),
    8,
    true,
  );

  const candidateNoteIds = [...new Set(candidates.map((hit) => hit.noteId))];
  const existingRows = candidateNoteIds.length
    ? db.exec(
        `SELECT id, project_key, outcome_type, summary, raw_llm_response, error_signatures
           FROM notes
          WHERE id IN (${candidateNoteIds.map(() => '?').join(',')})`,
        candidateNoteIds,
      )
    : [];
  const existingById = new Map(
    (existingRows[0]?.values ?? []).map((row) => {
      const raw = safeParseObject(row[4]);
      return [
        Number(row[0]),
        {
          note_id: Number(row[0]),
          project_key: row[1] ? String(row[1]) : undefined,
          outcome_type: row[2] ? String(row[2]) : undefined,
          summary: String(row[3] ?? ''),
          root_cause:
            typeof raw.root_cause === 'string' ? raw.root_cause : undefined,
          resolution:
            typeof raw.resolution === 'string' ? raw.resolution : undefined,
          error_signatures: safeParseStringArray(row[5]),
        },
      ];
    }),
  );

  const decision = decideWritebackAction(
    {
      project_key: resolvedProjectKey,
      outcome_type: request.memory.outcome_type,
      summary: request.memory.summary,
      root_cause: request.memory.root_cause,
      resolution: request.memory.resolution,
      error_signatures: request.memory.error_signatures,
    },
    candidates
      .map((hit) => existingById.get(hit.noteId))
      .filter((value): value is NonNullable<typeof value> => Boolean(value)),
  );

  const persisted = withTransaction(db, () => {
    if (decision.decision === 'skipped') {
      if (request.mode === 'auto') {
        db.run(
          `INSERT INTO writeback_receipts (
             source_agent, source_run_key, decision, note_id, merged_into_note_id, reason, index_status
           ) VALUES (?, ?, 'skipped', NULL, NULL, ?, 'completed')`,
          [normalizedAgent, request.source_run_key ?? null, decision.reason],
        );
      }

      return {
        decision: 'skipped' as const,
        note_id: null,
        merged_into_note_id: null,
        related_note_ids: [] as number[],
      };
    }

    if (decision.decision === 'merged' && decision.target_note_id) {
      const existingPayloadRows = db.exec(
        `SELECT key_conclusions, code_snippets, raw_llm_response, error_signatures, files_touched
           FROM notes
          WHERE id = ?`,
        [decision.target_note_id],
      );
      const existingKeyConclusions = safeParseStringArray(
        existingPayloadRows[0]?.values[0]?.[0],
      );
      const existingCodeSnippets = safeParseArray<Record<string, unknown>>(
        existingPayloadRows[0]?.values[0]?.[1],
      );
      const mergedPayload = mergeMemoryPayload(
        safeParseObject(existingPayloadRows[0]?.values[0]?.[2]),
        request.memory as Record<string, unknown>,
      );
      const mergedKeyConclusions = [
        ...new Set([
          ...existingKeyConclusions,
          ...(request.memory.key_conclusions ?? []),
        ]),
      ];
      const mergedCodeSnippets =
        mergeCodeSnippets(existingCodeSnippets, request.memory.code_snippets) ??
        [];
      const mergedErrorSignatures = [
        ...new Set([
          ...safeParseStringArray(existingPayloadRows[0]?.values[0]?.[3]),
          ...(request.memory.error_signatures ?? []),
        ]),
      ];
      const mergedFilesTouched = [
        ...new Set([
          ...safeParseStringArray(existingPayloadRows[0]?.values[0]?.[4]),
          ...(request.memory.files_touched ?? []),
        ]),
      ];

      db.run(
        `UPDATE notes
            SET summary = summary || '\n\nEvidence update:\n' || ?,
                key_conclusions = ?,
                code_snippets = ?,
                raw_llm_response = ?,
                error_signatures = ?,
                files_touched = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
        [
          request.memory.summary,
          JSON.stringify(mergedKeyConclusions),
          JSON.stringify(mergedCodeSnippets),
          JSON.stringify(mergedPayload),
          JSON.stringify(mergedErrorSignatures),
          JSON.stringify(mergedFilesTouched),
          decision.target_note_id,
        ],
      );

      if (request.mode === 'auto') {
        db.run(
          `INSERT INTO writeback_receipts (
             source_agent, source_run_key, decision, note_id, merged_into_note_id, reason, index_status
           ) VALUES (?, ?, 'merged', NULL, ?, ?, 'pending')`,
          [
            normalizedAgent,
            request.source_run_key ?? null,
            decision.target_note_id,
            decision.reason,
          ],
        );
      }

      return {
        decision: 'merged' as const,
        note_id: null,
        merged_into_note_id: decision.target_note_id,
        related_note_ids: [] as number[],
        tags: normalizeTags(mergedPayload.tags as string[] | undefined),
      };
    }

    const originConversationId = ensureSyntheticOriginConversation(db, {
      originId: request.source_run_key ?? `manual:${Date.now()}`,
      projectDir: request.task.project_dir ?? request.task.cwd ?? '.',
      projectName: request.task.project_dir
        ? request.task.project_dir.split(/[\\/]/).pop() ?? 'memory'
        : 'memory',
      cwd: request.task.cwd,
      gitBranch: request.task.branch,
    });

    db.run(
      `INSERT INTO notes (
        conversation_id, title, summary, key_conclusions, code_snippets, raw_llm_response, is_edited,
        project_key, scope, source_type, source_agent, task_kind, error_signatures, files_touched, outcome_type
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        originConversationId,
        request.memory.title ?? request.task.goal,
        request.memory.summary,
        JSON.stringify(request.memory.key_conclusions ?? []),
        JSON.stringify(request.memory.code_snippets ?? []),
        JSON.stringify(request.memory),
        resolvedProjectKey ?? null,
        normalizedScope,
        request.mode === 'manual' ? 'manual-note' : 'agent-writeback',
        normalizedAgent,
        request.task.task_kind,
        JSON.stringify(request.memory.error_signatures ?? []),
        JSON.stringify(request.memory.files_touched ?? []),
        request.memory.outcome_type,
      ],
    );

    const created = db.exec(
      'SELECT id FROM notes WHERE conversation_id = ?',
      [originConversationId],
    );
    const createdNoteId = Number(created[0].values[0][0]);

    if (request.mode === 'auto') {
      db.run(
        `INSERT INTO writeback_receipts (
           source_agent, source_run_key, decision, note_id, merged_into_note_id, reason, index_status
         ) VALUES (?, ?, 'created', ?, NULL, ?, 'pending')`,
        [
          normalizedAgent,
          request.source_run_key ?? null,
          createdNoteId,
          decision.reason,
        ],
      );
    }

    return {
      decision: 'created' as const,
      note_id: createdNoteId,
      merged_into_note_id: null,
      tags: normalizeTags(request.memory.tags),
      related_note_ids: candidates
        .filter((hit) => hit.score >= 0.75)
        .map((hit) => hit.noteId)
        .filter(
          (value, index, array) => array.indexOf(value) === index,
        )
        .slice(0, 3),
    };
  });

  if (persisted.note_id) {
    upsertRelatedMemoryRelations(db, persisted.note_id, persisted.related_note_ids);
  }
  if (persisted.note_id || persisted.merged_into_note_id) {
    upsertNoteTags(
      db,
      persisted.note_id ?? persisted.merged_into_note_id!,
      persisted.tags,
    );
  }

  const embeddingTargetId = persisted.note_id ?? persisted.merged_into_note_id;
  if (embeddingTargetId) {
    await embedNote(embeddingTargetId);
    if (request.mode === 'auto') {
      db.run(
        `UPDATE writeback_receipts
            SET index_status = 'completed'
          WHERE source_agent = ? AND source_run_key = ?`,
        [normalizedAgent, request.source_run_key ?? null],
      );
    }
  }

  return {
    mode: request.mode,
    decision: persisted.decision,
    note_id: persisted.note_id,
    merged_into_note_id: persisted.merged_into_note_id,
    reason: decision.reason,
    warnings: [],
  };
}
