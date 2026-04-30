import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { DeleteNoteReviewRequest } from '@chatcrystal/shared';
import initSqlJs, { type Database } from 'sql.js';
import { SCHEMA_SQL } from '../../db/schema.js';
import {
  DeleteNoteReviewValidationError,
  NoteNotFoundForReviewError,
  deleteNoteWithReview,
} from './reviews.js';

async function createSqlDatabase() {
  const SQL = await initSqlJs({
    locateFile: (file) =>
      fileURLToPath(
        new URL(`../../../../node_modules/sql.js/dist/${file}`, import.meta.url),
      ),
  });
  const db = new SQL.Database();
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

function insertConversation(
  db: Database,
  id: string,
  options: {
    status?: string;
    score?: number | null;
    reason?: string | null;
    details?: string | null;
  } = {},
) {
  db.run(
    `INSERT INTO conversations (
      id, source, project_dir, project_name, cwd, git_branch, message_count,
      first_message_at, last_message_at, file_path, file_size, file_mtime,
      status, experience_score, experience_gate_reason, experience_gate_details
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      'codex',
      'C:/repo',
      'repo',
      'C:/repo',
      'main',
      1,
      '2026-04-29T00:00:00Z',
      '2026-04-29T00:01:00Z',
      `C:/repo/${id}.jsonl`,
      1,
      '2026-04-29T00:00:00Z',
      options.status ?? 'summarized',
      options.score ?? null,
      options.reason ?? null,
      options.details ?? null,
    ],
  );
}

function insertNote(db: Database, conversationId: string, noteId: number) {
  db.run(
    `INSERT INTO notes (
      id, conversation_id, title, summary, key_conclusions, code_snippets
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      noteId,
      conversationId,
      `Note ${noteId}`,
      'This note was accepted by the gate.',
      JSON.stringify([]),
      JSON.stringify([]),
    ],
  );
}

function scalar(db: Database, sql: string, params: Array<string | number> = []) {
  return db.exec(sql, params)[0]?.values[0]?.[0] ?? null;
}

test('deleteNoteWithReview deletes a note and records false_accept feedback with gate audit details', async () => {
  const db = await createSqlDatabase();
  const previousGateDetails = JSON.stringify({
    reasons: ['experience-threshold-met'],
    dimensions: { reuse_potential: 18 },
  });
  insertConversation(db, 'conv-delete', {
    score: 83,
    reason: 'experience-threshold-met',
    details: previousGateDetails,
  });
  insertNote(db, 'conv-delete', 10);
  insertConversation(db, 'conv-related');
  insertNote(db, 'conv-related', 11);
  db.run('INSERT INTO tags (id, name) VALUES (1, ?)', ['debug']);
  db.run('INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)', [10, 1]);
  db.run(
    'INSERT INTO embeddings (note_id, chunk_index, chunk_text, vectra_id) VALUES (?, 0, ?, ?)',
    [10, 'chunk text', 'vectra-10'],
  );
  db.run(
    `INSERT INTO note_relations (
      source_note_id, target_note_id, relation_type, confidence, created_by
    ) VALUES (?, ?, 'SIMILAR_TO', 0.8, 'manual')`,
    [10, 11],
  );
  db.run(
    `INSERT INTO note_relations (
      source_note_id, target_note_id, relation_type, confidence, created_by
    ) VALUES (?, ?, 'REFERENCES', 0.7, 'manual')`,
    [11, 10],
  );
  let saves = 0;

  const result = await deleteNoteWithReview(
    10,
    {
      reason: 'not-experience',
      comment: '  This was just a generic explanation.  ',
      source: 'web',
    },
    {
      db: db as never,
      save: () => {
        saves++;
      },
    },
  );

  assert.equal(result.noteId, 10);
  assert.equal(result.conversationId, 'conv-delete');
  assert.equal(result.conversationStatus, 'filtered');
  assert.equal(typeof result.reviewId, 'number');
  assert.equal(saves, 1);
  assert.equal(scalar(db, 'SELECT COUNT(*) FROM notes WHERE id = ?', [10]), 0);
  assert.equal(
    scalar(db, 'SELECT COUNT(*) FROM note_tags WHERE note_id = ?', [10]),
    0,
  );
  assert.equal(
    scalar(db, 'SELECT COUNT(*) FROM embeddings WHERE note_id = ?', [10]),
    0,
  );
  assert.equal(
    scalar(
      db,
      'SELECT COUNT(*) FROM note_relations WHERE source_note_id = ? OR target_note_id = ?',
      [10, 10],
    ),
    0,
  );

  const review = db.exec(
    `SELECT
       target_type, target_id, conversation_id, note_id, verdict, reason,
       comment, source, gate_score, gate_reason, gate_details
     FROM experience_reviews
     WHERE id = ?`,
    [result.reviewId],
  )[0].values[0];
  assert.deepEqual(review, [
    'note',
    '10',
    'conv-delete',
    null,
    'false_accept',
    'not-experience',
    'This was just a generic explanation.',
    'web',
    83,
    'experience-threshold-met',
    previousGateDetails,
  ]);

  const conversation = db.exec(
    `SELECT status, experience_gate_reason, experience_gate_details
       FROM conversations
      WHERE id = ?`,
    ['conv-delete'],
  )[0].values[0];
  assert.equal(conversation[0], 'filtered');
  assert.equal(conversation[1], 'user-rejected-note');
  assert.deepEqual(JSON.parse(String(conversation[2])), {
    feedback: {
      verdict: 'false_accept',
      reason: 'not-experience',
      comment: 'This was just a generic explanation.',
      source: 'web',
      note_id: 10,
      review_id: result.reviewId,
    },
    previous_gate: {
      score: 83,
      reason: 'experience-threshold-met',
      details: {
        reasons: ['experience-threshold-met'],
        dimensions: { reuse_potential: 18 },
      },
    },
  });
});

test('deleteNoteWithReview preserves invalid previous gate details as raw text', async () => {
  const db = await createSqlDatabase();
  insertConversation(db, 'conv-invalid-json', {
    score: 12,
    reason: 'experience-threshold-met',
    details: '{invalid',
  });
  insertNote(db, 'conv-invalid-json', 12);

  const result = await deleteNoteWithReview(
    12,
    { reason: 'other', source: 'cli' },
    { db: db as never, save: () => undefined },
  );

  const details = JSON.parse(
    String(
      scalar(
        db,
        'SELECT experience_gate_details FROM conversations WHERE id = ?',
        ['conv-invalid-json'],
      ),
    ),
  );

  assert.equal(result.noteId, 12);
  assert.equal(details.previous_gate.details, '{invalid');
});

test('deleteNoteWithReview validates reason before deleting', async () => {
  const db = await createSqlDatabase();
  insertConversation(db, 'conv-invalid-reason');
  insertNote(db, 'conv-invalid-reason', 13);
  let saves = 0;

  await assert.rejects(
    deleteNoteWithReview(
      13,
      {
        reason: 'bad-reason',
        source: 'web',
      } as unknown as DeleteNoteReviewRequest,
      {
        db: db as never,
        save: () => {
          saves++;
        },
      },
    ),
    DeleteNoteReviewValidationError,
  );

  assert.equal(saves, 0);
  assert.equal(scalar(db, 'SELECT COUNT(*) FROM notes WHERE id = ?', [13]), 1);
  assert.equal(scalar(db, 'SELECT COUNT(*) FROM experience_reviews'), 0);
});

test('deleteNoteWithReview validates noteId before deleting when it is zero', async () => {
  const db = await createSqlDatabase();
  insertConversation(db, 'conv-zero-note-id');
  insertNote(db, 'conv-zero-note-id', 10);
  let saves = 0;

  await assert.rejects(
    deleteNoteWithReview(
      0,
      { reason: 'duplicate', source: 'web' },
      {
        db: db as never,
        save: () => {
          saves++;
        },
      },
    ),
    DeleteNoteReviewValidationError,
  );

  assert.equal(saves, 0);
  assert.equal(scalar(db, 'SELECT COUNT(*) FROM notes WHERE id = ?', [10]), 1);
  assert.equal(scalar(db, 'SELECT COUNT(*) FROM experience_reviews'), 0);
});

test('deleteNoteWithReview validates noteId before deleting when it is NaN', async () => {
  const db = await createSqlDatabase();
  insertConversation(db, 'conv-nan-note-id');
  insertNote(db, 'conv-nan-note-id', 10);
  let saves = 0;

  await assert.rejects(
    deleteNoteWithReview(
      Number.NaN,
      { reason: 'duplicate', source: 'web' },
      {
        db: db as never,
        save: () => {
          saves++;
        },
      },
    ),
    DeleteNoteReviewValidationError,
  );

  assert.equal(saves, 0);
  assert.equal(scalar(db, 'SELECT COUNT(*) FROM notes WHERE id = ?', [10]), 1);
  assert.equal(scalar(db, 'SELECT COUNT(*) FROM experience_reviews'), 0);
});

test('deleteNoteWithReview validates input shape before deleting when input is null', async () => {
  const db = await createSqlDatabase();
  insertConversation(db, 'conv-null-input');
  insertNote(db, 'conv-null-input', 10);
  let saves = 0;

  await assert.rejects(
    deleteNoteWithReview(10, null as never, {
      db: db as never,
      save: () => {
        saves++;
      },
    }),
    DeleteNoteReviewValidationError,
  );

  assert.equal(saves, 0);
  assert.equal(scalar(db, 'SELECT COUNT(*) FROM notes WHERE id = ?', [10]), 1);
  assert.equal(scalar(db, 'SELECT COUNT(*) FROM experience_reviews'), 0);
});

test('deleteNoteWithReview validates comment type before deleting', async () => {
  const db = await createSqlDatabase();
  insertConversation(db, 'conv-invalid-comment');
  insertNote(db, 'conv-invalid-comment', 10);
  let saves = 0;

  await assert.rejects(
    deleteNoteWithReview(
      10,
      { reason: 'other', source: 'web', comment: 123 } as never,
      {
        db: db as never,
        save: () => {
          saves++;
        },
      },
    ),
    DeleteNoteReviewValidationError,
  );

  assert.equal(saves, 0);
  assert.equal(scalar(db, 'SELECT COUNT(*) FROM notes WHERE id = ?', [10]), 1);
  assert.equal(scalar(db, 'SELECT COUNT(*) FROM experience_reviews'), 0);
});

test('deleteNoteWithReview throws for missing notes', async () => {
  const db = await createSqlDatabase();
  let saves = 0;

  await assert.rejects(
    deleteNoteWithReview(
      404,
      { reason: 'duplicate', source: 'tui' },
      {
        db: db as never,
        save: () => {
          saves++;
        },
      },
    ),
    NoteNotFoundForReviewError,
  );

  assert.equal(saves, 0);
  assert.equal(scalar(db, 'SELECT COUNT(*) FROM experience_reviews'), 0);
});
