import type { Database } from 'sql.js';
import { getDatabase, saveDatabase } from '../db/index.js';
import { deleteNoteVectraItems } from './embedding.js';

type DeleteNoteVectors = (noteId: number) => Promise<unknown>;

type VectorCleanupDeps = {
  db?: Database;
  save?: () => void;
  deleteNoteVectors?: DeleteNoteVectors;
};

type ProcessPendingOptions = VectorCleanupDeps & {
  limit?: number;
};

export type VectorCleanupResult = {
  processed: boolean;
  deleted: number;
};

export type PendingVectorCleanupResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  deleted: number;
};

function resolveDb(deps: VectorCleanupDeps): Database {
  return deps.db ?? getDatabase();
}

function resolveSave(deps: VectorCleanupDeps): () => void {
  return deps.save ?? saveDatabase;
}

function resolveDeleteNoteVectors(deps: VectorCleanupDeps): DeleteNoteVectors {
  return deps.deleteNoteVectors ?? deleteNoteVectraItems;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeDeletedCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function enqueueNoteVectorCleanupTask(
  noteId: number,
  deps: Pick<VectorCleanupDeps, 'db'> = {},
): void {
  const db = resolveDb(deps);

  db.run(
    `INSERT INTO vector_cleanup_tasks (
       target_type, target_id, status, attempts, last_error, updated_at
     ) VALUES ('note', ?, 'pending', 0, NULL, datetime('now'))
     ON CONFLICT(target_type, target_id) DO UPDATE SET
       status = 'pending',
       updated_at = datetime('now')`,
    [String(noteId)],
  );
}

export async function processNoteVectorCleanupTask(
  noteId: number,
  deps: VectorCleanupDeps = {},
): Promise<VectorCleanupResult> {
  const db = resolveDb(deps);
  const save = resolveSave(deps);
  const deleteNoteVectors = resolveDeleteNoteVectors(deps);
  const targetId = String(noteId);

  const task = db.exec(
    `SELECT id
       FROM vector_cleanup_tasks
      WHERE target_type = 'note'
        AND target_id = ?
        AND status = 'pending'
      LIMIT 1`,
    [targetId],
  );

  if (!task.length || !task[0].values.length) {
    return { processed: false, deleted: 0 };
  }

  try {
    const deleted = normalizeDeletedCount(await deleteNoteVectors(noteId));
    db.run(
      "DELETE FROM vector_cleanup_tasks WHERE target_type = 'note' AND target_id = ?",
      [targetId],
    );
    save();
    return { processed: true, deleted };
  } catch (error) {
    db.run(
      `UPDATE vector_cleanup_tasks
          SET status = 'pending',
              attempts = attempts + 1,
              last_error = ?,
              updated_at = datetime('now')
        WHERE target_type = 'note'
          AND target_id = ?`,
      [errorMessage(error), targetId],
    );
    save();
    throw error;
  }
}

export async function processPendingVectorCleanupTasks(
  options: ProcessPendingOptions = {},
): Promise<PendingVectorCleanupResult> {
  const db = resolveDb(options);
  const requestedLimit = options.limit ?? 25;
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(0, Math.min(Math.trunc(requestedLimit), 100))
    : 25;
  const result: PendingVectorCleanupResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    deleted: 0,
  };

  if (limit === 0) {
    return result;
  }

  const rows = db.exec(
    `SELECT target_id
       FROM vector_cleanup_tasks
      WHERE target_type = 'note'
        AND status = 'pending'
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    [limit],
  )[0]?.values ?? [];

  for (const row of rows) {
    const noteId = Number(row[0]);
    result.attempted++;

    try {
      const cleanup = await processNoteVectorCleanupTask(noteId, options);
      if (cleanup.processed) {
        result.succeeded++;
        result.deleted += cleanup.deleted;
      }
    } catch {
      result.failed++;
    }
  }

  return result;
}
