import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';

const dataDir = mkdtempSync(join(tmpdir(), 'chatcrystal-tags-route-test-'));
process.env.DATA_DIR = dataDir;

const dbService = await import('../db/index.js');
const { noteRoutes } = await import('./notes.js');

function resetDatabase() {
  const db = dbService.getDatabase();
  db.exec(`
    PRAGMA foreign_keys = ON;
    DELETE FROM experience_reviews;
    DELETE FROM note_tags;
    DELETE FROM embeddings;
    DELETE FROM note_relations;
    DELETE FROM notes;
    DELETE FROM messages;
    DELETE FROM conversations;
    DELETE FROM tags;
    DELETE FROM import_log;
    DELETE FROM vector_cleanup_tasks;
  `);
}

test('GET /api/tags returns only tags that are used by notes', async () => {
  const db = await dbService.initDatabase();
  resetDatabase();

  db.exec(`
    INSERT INTO conversations (
      id, source, project_dir, project_name, first_message_at, last_message_at,
      file_path
    ) VALUES (
      'conversation-1', 'codex', 'C:/repo', 'repo', '2026-04-29',
      '2026-04-29', 'a.jsonl'
    );

    INSERT INTO notes (
      id, conversation_id, title, summary
    ) VALUES (
      1, 'conversation-1', 'Useful note', 'This note should keep its tag.'
    );

    INSERT INTO tags (id, name) VALUES (1, 'used'), (2, 'orphan');
    INSERT INTO note_tags (note_id, tag_id) VALUES (1, 1);
  `);

  const app = Fastify();
  await app.register(noteRoutes);

  try {
    const response = await app.inject({ method: 'GET', url: '/api/tags' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().data, [{ id: 1, name: 'used', count: 1 }]);
  } finally {
    await app.close();
    dbService.closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
