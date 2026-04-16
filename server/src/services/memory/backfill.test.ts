import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { SCHEMA_SQL } from '../../db/schema.js';
import {
  backfillImportedNoteMetadata,
  mapConversationSourceToAgent,
} from './backfill.js';

async function createDb() {
  const SQL = await initSqlJs({
    locateFile: (file) =>
      fileURLToPath(
        new URL(`../../../../node_modules/sql.js/dist/${file}`, import.meta.url),
      ),
  });
  const db = new SQL.Database();
  db.exec(SCHEMA_SQL);
  db.run(
    `INSERT INTO conversations (
      id, source, project_dir, project_name, cwd, git_branch, message_count,
      first_message_at, last_message_at, file_path, file_size, file_mtime, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'conv-1',
      'codex',
      'C:/repo',
      'repo',
      'C:/repo',
      'main',
      2,
      '2026-04-15T00:00:00Z',
      '2026-04-15T00:05:00Z',
      'C:/repo/session.jsonl',
      1,
      '2026-04-15T00:05:00Z',
      'summarized',
    ],
  );
  db.run(`INSERT INTO notes (conversation_id, title, summary) VALUES (?, ?, ?)`, [
    'conv-1',
    'Old note',
    'Imported summary',
  ]);
  return db;
}

test('backfillImportedNoteMetadata populates metadata for legacy imported notes', async () => {
  const db = await createDb();
  backfillImportedNoteMetadata(db as never);

  const rows = db.exec(
    'SELECT project_key, scope, source_type, source_agent FROM notes WHERE conversation_id = ?',
    ['conv-1'],
  );
  assert.equal(rows[0].values[0][1], 'project');
  assert.equal(rows[0].values[0][2], 'imported-conversation');
  assert.equal(rows[0].values[0][3], 'codex');
});

test('mapConversationSourceToAgent recognizes trae as a first-class source agent', () => {
  assert.equal(mapConversationSourceToAgent('trae'), 'trae');
});
