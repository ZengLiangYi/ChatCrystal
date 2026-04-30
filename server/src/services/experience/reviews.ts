import type {
  DeleteNoteReviewRequest,
  DeleteNoteReviewResponse,
  ExperienceReviewReason,
  ExperienceReviewSource,
} from '@chatcrystal/shared';
import type { Database } from 'sql.js';
import { getDatabase, saveDatabase } from '../../db/index.js';
import { withTransaction } from '../../db/transaction.js';
import { deleteNoteVectraItems } from '../embedding.js';

const VALID_REASONS = new Set<ExperienceReviewReason>([
  'low-value',
  'inaccurate',
  'not-experience',
  'duplicate',
  'other',
]);

const VALID_SOURCES = new Set<ExperienceReviewSource>([
  'web',
  'cli',
  'tui',
  'mcp',
  'system',
]);

export class DeleteNoteReviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeleteNoteReviewValidationError';
  }
}

export class NoteNotFoundForReviewError extends Error {
  constructor(noteId: number) {
    super(`Note ${noteId} was not found for review deletion`);
    this.name = 'NoteNotFoundForReviewError';
  }
}

type DeleteNoteWithReviewDeps = {
  db?: Database;
  save?: () => void;
  deleteNoteVectors?: (noteId: number) => Promise<unknown>;
};

type NoteGateSnapshot = {
  conversationId: string;
  gateScore: number | null;
  gateReason: string | null;
  gateDetails: string | null;
};

function validateRequest(
  noteId: number,
  input: unknown,
): DeleteNoteReviewRequest {
  if (!Number.isInteger(noteId) || noteId <= 0) {
    throw new DeleteNoteReviewValidationError(
      `Invalid note id: ${String(noteId)}`,
    );
  }

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new DeleteNoteReviewValidationError('Review request must be an object');
  }

  const request = input as Partial<DeleteNoteReviewRequest>;

  if (
    typeof request.reason !== 'string' ||
    !VALID_REASONS.has(request.reason as ExperienceReviewReason)
  ) {
    throw new DeleteNoteReviewValidationError(
      `Invalid review reason: ${String(request.reason)}`,
    );
  }

  if (
    typeof request.source !== 'string' ||
    !VALID_SOURCES.has(request.source as ExperienceReviewSource)
  ) {
    throw new DeleteNoteReviewValidationError(
      `Invalid review source: ${String(request.source)}`,
    );
  }

  if (
    request.comment !== undefined &&
    typeof request.comment !== 'string'
  ) {
    throw new DeleteNoteReviewValidationError(
      `Invalid review comment: ${String(request.comment)}`,
    );
  }

  return {
    reason: request.reason as ExperienceReviewReason,
    source: request.source as ExperienceReviewSource,
    comment: request.comment,
  };
}

function normalizeComment(comment: string | undefined): string | null {
  const trimmed = comment?.trim() ?? '';
  return trimmed ? trimmed.slice(0, 500) : null;
}

function parseGateDetails(details: string | null): unknown {
  if (!details) return null;

  try {
    return JSON.parse(details);
  } catch {
    return details;
  }
}

function loadNoteGateSnapshot(
  db: Database,
  noteId: number,
): NoteGateSnapshot | null {
  const result = db.exec(
    `SELECT
       n.conversation_id,
       c.experience_score,
       c.experience_gate_reason,
       c.experience_gate_details
     FROM notes n
     JOIN conversations c ON c.id = n.conversation_id
     WHERE n.id = ?`,
    [noteId],
  );
  const row = result[0]?.values[0];
  if (!row) return null;

  return {
    conversationId: String(row[0]),
    gateScore: row[1] === null || row[1] === undefined ? null : Number(row[1]),
    gateReason: row[2] === null || row[2] === undefined ? null : String(row[2]),
    gateDetails: row[3] === null || row[3] === undefined ? null : String(row[3]),
  };
}

function lastInsertId(db: Database): number {
  return Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
}

export async function deleteNoteWithReview(
  noteId: number,
  input: DeleteNoteReviewRequest,
  deps: DeleteNoteWithReviewDeps = {},
): Promise<DeleteNoteReviewResponse> {
  const request = validateRequest(noteId, input);

  const db = deps.db ?? getDatabase();
  const save = deps.save ?? saveDatabase;
  const deleteNoteVectors = deps.deleteNoteVectors ?? deleteNoteVectraItems;
  const comment = normalizeComment(request.comment);

  const persisted = withTransaction(db, () => {
    const snapshot = loadNoteGateSnapshot(db, noteId);
    if (!snapshot) {
      throw new NoteNotFoundForReviewError(noteId);
    }

    db.run(
      `INSERT INTO experience_reviews (
        target_type, target_id, conversation_id, note_id, verdict, reason,
        comment, source, gate_score, gate_reason, gate_details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'note',
        String(noteId),
        snapshot.conversationId,
        noteId,
        'false_accept',
        request.reason,
        comment,
        request.source,
        snapshot.gateScore,
        snapshot.gateReason,
        snapshot.gateDetails,
      ],
    );

    const reviewId = lastInsertId(db);
    const auditDetails = {
      feedback: {
        verdict: 'false_accept',
        reason: request.reason,
        comment,
        source: request.source,
        note_id: noteId,
        review_id: reviewId,
      },
      previous_gate: {
        score: snapshot.gateScore,
        reason: snapshot.gateReason,
        details: parseGateDetails(snapshot.gateDetails),
      },
    };

    db.run(
      `UPDATE conversations
          SET status = 'filtered',
              experience_gate_reason = ?,
              experience_gate_details = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
      [
        'user-rejected-note',
        JSON.stringify(auditDetails),
        snapshot.conversationId,
      ],
    );

    db.run('DELETE FROM notes WHERE id = ?', [noteId]);

    return {
      reviewId,
      conversationId: snapshot.conversationId,
    };
  });

  save();
  await deleteNoteVectors(noteId);

  return {
    noteId,
    conversationId: persisted.conversationId,
    reviewId: persisted.reviewId,
    conversationStatus: 'filtered',
  };
}
