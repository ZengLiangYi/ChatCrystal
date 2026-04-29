import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import { SCHEMA_SQL } from '../db/schema.js';
import { triggerSummarize } from './summarize.js';

async function createSqlDatabase() {
  const SQL = await initSqlJs({
    locateFile: (file) =>
      fileURLToPath(
        new URL(`../../../node_modules/sql.js/dist/${file}`, import.meta.url),
      ),
  });
  const db = new SQL.Database();
  db.exec(SCHEMA_SQL);
  return db;
}

function insertConversation(db: Database, id: string) {
  db.run(
    `INSERT INTO conversations (
      id, source, project_dir, project_name, cwd, git_branch, message_count,
      first_message_at, last_message_at, file_path, file_size, file_mtime, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      'codex',
      'C:/repo',
      'repo',
      'C:/repo',
      'main',
      2,
      '2026-04-29T00:00:00Z',
      '2026-04-29T00:01:00Z',
      `C:/repo/${id}.jsonl`,
      1,
      '2026-04-29T00:00:00Z',
      'imported',
    ],
  );
}

function insertMessage(
  db: Database,
  conversationId: string,
  id: string,
  type: string,
  content: string,
  sortOrder: number,
) {
  db.run(
    `INSERT INTO messages (
      id, conversation_id, type, role, content, has_tool_use, has_code, timestamp, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      conversationId,
      type,
      type,
      content,
      0,
      content.includes('server/src') ? 1 : 0,
      '2026-04-29T00:00:00Z',
      sortOrder,
    ],
  );
}

test('triggerSummarize marks rejected conversations as filtered without creating notes', async () => {
  const db = await createSqlDatabase();
  insertConversation(db, 'conv-low');
  insertMessage(db, 'conv-low', 'm1', 'user', 'TypeScript interface 是什么？', 1);
  insertMessage(db, 'conv-low', 'm2', 'assistant', 'interface 描述对象形状。', 2);

  const result = await triggerSummarize('conv-low', {
    db: db as never,
    save: () => undefined,
    prepareTranscript: () => 'short informational transcript',
    evaluateExperience: async () => ({
      decision: 'reject',
      score: 0,
      confidence: 0.9,
      reasons: ['low-signal'],
      missing_signals: ['problem', 'outcome', 'reuse'],
      dimensions: {
        problem_clarity: 0,
        process_depth: 0,
        decision_value: 0,
        outcome_closure: 0,
        reuse_potential: 0,
      },
    }),
    summarizeConversation: async () => {
      throw new Error('summarize should not run');
    },
    generateEmbeddings: async () => 1,
    discoverRelations: async () => undefined,
  });

  const conv = db.exec(
    'SELECT status, experience_score, experience_gate_reason FROM conversations WHERE id = ?',
    ['conv-low'],
  )[0].values[0];
  const notes = db.exec('SELECT COUNT(*) FROM notes');

  assert.equal(result, null);
  assert.deepEqual(conv, ['filtered', 0, 'low-signal']);
  assert.equal(Number(notes[0].values[0][0]), 0);
});

test('triggerSummarize creates notes for accepted conversations', async () => {
  const db = await createSqlDatabase();
  insertConversation(db, 'conv-good');
  insertMessage(
    db,
    'conv-good',
    'm1',
    'user',
    'server/src/routes/memory.test.ts fails with ECONNREFUSED. Need root cause and fix.',
    1,
  );
  insertMessage(
    db,
    'conv-good',
    'm2',
    'assistant',
    'Found the request raced server readiness. Resolution: await readiness before requests. Verification passed.',
    2,
  );

  const result = await triggerSummarize('conv-good', {
    db: db as never,
    save: () => undefined,
    prepareTranscript: () =>
      'debugging transcript with root cause, resolution, verification, and reusable pattern',
    evaluateExperience: async () => ({
      decision: 'accept',
      score: 82,
      confidence: 0.8,
      reasons: ['experience-threshold-met'],
      missing_signals: [],
      dimensions: {
        problem_clarity: 18,
        process_depth: 16,
        decision_value: 15,
        outcome_closure: 17,
        reuse_potential: 16,
      },
    }),
    summarizeConversation: async () => ({
      title: 'Fix readiness race',
      summary: 'Await server readiness before requests to avoid ECONNREFUSED.',
      key_conclusions: ['Requests can race server startup.'],
      code_snippets: [],
      tags: ['debug', 'testing'],
      raw_response: '{}',
    }),
    generateEmbeddings: async () => 1,
    discoverRelations: async () => undefined,
  });

  const noteCount = db.exec('SELECT COUNT(*) FROM notes');
  const status = db.exec('SELECT status FROM conversations WHERE id = ?', ['conv-good']);

  assert.equal(typeof result, 'number');
  assert.equal(Number(noteCount[0].values[0][0]), 1);
  assert.equal(status[0].values[0][0], 'summarized');
});
