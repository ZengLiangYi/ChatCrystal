import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';

const dataDir = mkdtempSync(join(tmpdir(), 'chatcrystal-summarize-route-test-'));
process.env.DATA_DIR = dataDir;

const dbService = await import('../db/index.js');
const queue = await import('../queue/index.js');
const { noteRoutes } = await import('./notes.js');

function resetDatabase(db: Awaited<ReturnType<typeof dbService.initDatabase>>) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    DELETE FROM experience_reviews;
    DELETE FROM note_tags;
    DELETE FROM embeddings;
    DELETE FROM note_relations;
    DELETE FROM notes;
    DELETE FROM messages;
    DELETE FROM conversations;
    DELETE FROM import_log;
    DELETE FROM vector_cleanup_tasks;
  `);
}

function insertConversation(
  db: Awaited<ReturnType<typeof dbService.initDatabase>>,
  id: string,
  status: string,
) {
  db.run(
    `INSERT INTO conversations (
      id, source, project_name, project_dir, message_count,
      first_message_at, last_message_at, file_path, file_size, file_mtime, status
    ) VALUES (?, 'codex', 'p', 'p', 2, '2026-05-23', '2026-05-23', ?, 1, 'm', ?)`,
    [id, `C:/fixtures/${id}.jsonl`, status],
  );
}

test('summarize by ids reports summarized and unknown conversations without queueing them', async () => {
  const db = await dbService.initDatabase();
  resetDatabase(db);
  insertConversation(db, 'old-id', 'summarized');

  const app = Fastify();
  await app.register(noteRoutes);

  const res = await app.inject({
    method: 'POST',
    url: '/api/summarize/batch-ids',
    payload: { conversationIds: ['old-id', 'old-id', 'missing-id'] },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.queued, 0);
  assert.deepEqual(body.data.skipped, ['old-id']);
  assert.deepEqual(body.data.unknown, ['missing-id']);

  await app.close();
});

test('summarize by ids queues only requested imported conversations', async () => {
  const db = await dbService.initDatabase();
  resetDatabase(db);
  insertConversation(db, 'new-id', 'imported');
  insertConversation(db, 'old-id', 'summarized');

  const app = Fastify();
  await app.register(noteRoutes);
  queue.summarizeQueue.pause();

  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/summarize/batch-ids',
      payload: { conversationIds: ['new-id', 'old-id', 'missing-id'] },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.queued, 1);
    assert.deepEqual(body.data.skipped, ['old-id']);
    assert.deepEqual(body.data.unknown, ['missing-id']);
  } finally {
    queue.cancelQueue();
    queue.summarizeQueue.start();
  }

  await app.close();
});

test('summarize by ids accepts empty bodies as empty requests', async () => {
  const app = Fastify();
  await app.register(noteRoutes);

  const res = await app.inject({
    method: 'POST',
    url: '/api/summarize/batch-ids',
  });

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.queued, 0);
  assert.deepEqual(body.data.skipped, []);
  assert.deepEqual(body.data.unknown, []);

  await app.close();
});

test('summarize status by ids returns conversation status or unknown', async () => {
  const db = await dbService.initDatabase();
  resetDatabase(db);
  insertConversation(db, 'new-id', 'imported');
  insertConversation(db, 'old-id', 'summarized');

  const app = Fastify();
  await app.register(noteRoutes);

  const res = await app.inject({
    method: 'POST',
    url: '/api/summarize/status-ids',
    payload: { conversationIds: ['new-id', 'old-id', 'missing-id'] },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.success, true);
  assert.deepEqual(body.data.items, [
    { id: 'new-id', status: 'imported' },
    { id: 'old-id', status: 'summarized' },
    { id: 'missing-id', status: 'unknown' },
  ]);

  await app.close();
  dbService.closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});
