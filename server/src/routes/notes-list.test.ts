import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, afterEach } from 'node:test';
import Fastify from 'fastify';

const dataDir = mkdtempSync(join(tmpdir(), 'chatcrystal-notes-list-route-test-'));
process.env.DATA_DIR = dataDir;

const dbService = await import('../db/index.js');
const { noteRoutes } = await import('./notes.js');

type TestDatabase = Awaited<ReturnType<typeof dbService.initDatabase>>;

function resetDatabase(db: TestDatabase) {
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

function insertConversation(db: TestDatabase, id: string, source: string) {
  db.run(
    `INSERT INTO conversations (
      id, source, project_dir, project_name, first_message_at, last_message_at,
      file_path, status
    ) VALUES (?, ?, 'C:/repo', 'repo', '2026-05-01', '2026-05-01', ?, 'summarized')`,
    [id, source, `C:/repo/${id}.jsonl`],
  );
}

function insertNote(
  db: TestDatabase,
  input: {
    id: number;
    conversationId: string;
    title: string;
    sourceType: string;
    tags: string[];
  },
) {
  db.run(
    `INSERT INTO notes (
      id, conversation_id, title, summary, source_type, source_agent, task_kind, created_at
    ) VALUES (?, ?, ?, ?, ?, 'codex', 'debug', ?)`,
    [
      input.id,
      input.conversationId,
      input.title,
      `${input.title} summary`,
      input.sourceType,
      `2026-05-0${input.id} 00:00:00`,
    ],
  );

  for (const tag of input.tags) {
    db.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', [tag]);
    const tagId = Number(db.exec('SELECT id FROM tags WHERE name = ?', [tag])[0].values[0][0]);
    db.run('INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)', [input.id, tagId]);
  }
}

function seedNotes(db: TestDatabase) {
  insertConversation(db, 'conv-real', 'codex');
  insertConversation(db, 'memory:auto-run', 'chatcrystal-memory');
  insertConversation(db, 'memory:manual-note', 'chatcrystal-memory');

  insertNote(db, {
    id: 1,
    conversationId: 'conv-real',
    title: 'Imported conversation note',
    sourceType: 'imported-conversation',
    tags: ['alpha', 'beta'],
  });
  insertNote(db, {
    id: 2,
    conversationId: 'memory:auto-run',
    title: 'Agent writeback note',
    sourceType: 'agent-writeback',
    tags: ['alpha', 'memory'],
  });
  insertNote(db, {
    id: 3,
    conversationId: 'memory:manual-note',
    title: 'Manual memory note',
    sourceType: 'manual-note',
    tags: ['beta', 'memory'],
  });
}

async function createSeededApp() {
  const db = await dbService.initDatabase();
  resetDatabase(db);
  seedNotes(db);
  const app = Fastify();
  await app.register(noteRoutes);
  return app;
}

afterEach(() => {
  dbService.closeDatabase();
});

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

test('GET /api/notes annotates whether the original conversation can be opened', async () => {
  const app = await createSeededApp();

  try {
    const response = await app.inject({ method: 'GET', url: '/api/notes?limit=10' });

    assert.equal(response.statusCode, 200);
    const byTitle = new Map(
      response.json().data.items.map((item: Record<string, unknown>) => [
        item.title,
        item.can_open_original_conversation,
      ]),
    );
    assert.equal(byTitle.get('Imported conversation note'), true);
    assert.equal(byTitle.get('Agent writeback note'), false);
    assert.equal(byTitle.get('Manual memory note'), false);
  } finally {
    await app.close();
  }
});

test('GET /api/notes/:id returns original conversation availability for one note', async () => {
  const app = await createSeededApp();

  try {
    const response = await app.inject({ method: 'GET', url: '/api/notes/2' });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.source_type, 'agent-writeback');
    assert.equal(response.json().data.source_agent, 'codex');
    assert.equal(response.json().data.task_kind, 'debug');
    assert.equal(response.json().data.can_open_original_conversation, false);
  } finally {
    await app.close();
  }
});

test('GET /api/notes sourceKind=memory returns agent and manual memory notes', async () => {
  const app = await createSeededApp();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/notes?sourceKind=memory&limit=10',
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      response.json().data.items
        .map((item: Record<string, unknown>) => item.title)
        .sort(),
      ['Agent writeback note', 'Manual memory note'],
    );
  } finally {
    await app.close();
  }
});

test('GET /api/notes applies multiple tag filters as an intersection', async () => {
  const app = await createSeededApp();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/notes?tag=alpha&tag=beta&limit=10',
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      response.json().data.items.map((item: Record<string, unknown>) => item.title),
      ['Imported conversation note'],
    );
  } finally {
    await app.close();
  }
});
