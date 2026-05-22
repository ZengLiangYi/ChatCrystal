import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Database } from 'sql.js';
import type { RemoteImportItem } from '@chatcrystal/shared';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chatcrystal-ingest-test-'));

const [{ initDatabase }, { buildRemoteImportItem }, ingest] = await Promise.all([
  import('../db/index.js'),
  import('./importPayload.js'),
  import('./ingest.js'),
]);

const db = await initDatabase();

function resetDatabase(database: Database) {
  database.exec(`
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

function remoteItem(id: string, assistantContent = 'world'): RemoteImportItem {
  return buildRemoteImportItem(
    'codex',
    {
      id,
      source: 'codex',
      filePath: `C:/fixtures/${id}.jsonl`,
      fileSize: 100,
      fileMtime: '2026-05-20T00:00:00Z',
      projectDir: 'C:/repo',
    },
    {
      id,
      slug: id,
      source: 'codex',
      projectDir: 'C:/repo',
      projectName: 'repo',
      cwd: 'C:/repo',
      gitBranch: 'main',
      firstMessageAt: '2026-05-20T00:00:00Z',
      lastMessageAt: '2026-05-20T00:01:00Z',
      messages: [
        {
          id: 'm1',
          parentUuid: null,
          type: 'user',
          role: 'user',
          content: 'hello',
          hasToolUse: false,
          hasCode: false,
          thinking: null,
          timestamp: '2026-05-20T00:00:00Z',
        },
        {
          id: 'm2',
          parentUuid: 'm1',
          type: 'assistant',
          role: 'assistant',
          content: assistantContent,
          hasToolUse: false,
          hasCode: false,
          thinking: null,
          timestamp: '2026-05-20T00:01:00Z',
        },
      ],
    },
    'codex@test',
  );
}

test('ingestRemoteImport inserts namespaced conversations and messages', () => {
  resetDatabase(db);

  const result = ingest.ingestRemoteImport({ version: 1, items: [remoteItem('session-1')] });

  const conversation = db.exec(
    `SELECT id, source, source_conversation_id, content_hash, parser_version, file_path, file_size, file_mtime
       FROM conversations WHERE id = 'codex:session-1'`,
  )[0].values[0];
  const messages = db.exec(
    `SELECT id, parent_uuid FROM messages WHERE conversation_id = 'codex:session-1' ORDER BY sort_order`,
  )[0].values;

  assert.equal(result.imported, 1);
  assert.deepEqual(conversation.slice(0, 3), ['codex:session-1', 'codex', 'session-1']);
  assert.match(String(conversation[3]), /^[a-f0-9]{64}$/);
  assert.equal(conversation[4], 'codex@test');
  assert.deepEqual(messages, [
    ['codex:session-1:m1', null],
    ['codex:session-1:m2', 'codex:session-1:m1'],
  ]);
});

test('ingestRemoteImport skips identical content hashes even when file metadata changes', () => {
  resetDatabase(db);
  const first = remoteItem('session-1');
  ingest.ingestRemoteImport({ version: 1, items: [first] });
  const second = {
    ...first,
    parserVersion: 'codex@test2',
    parsed: {
      ...first.parsed,
      projectName: 'repo-renamed',
      cwd: 'C:/repo-renamed',
      gitBranch: 'dev',
    },
    meta: {
      ...first.meta,
      filePath: 'C:/new-path/session-1.jsonl',
      fileSize: 999,
      fileMtime: '2026-05-21T00:00:00Z',
    },
  };

  const result = ingest.ingestRemoteImport({ version: 1, items: [second] });

  assert.equal(result.skipped, 1);
  assert.equal(result.items[0].status, 'skipped');
  const conversation = db.exec(
    `SELECT file_path, file_size, file_mtime, parser_version, project_name, cwd, git_branch
       FROM conversations WHERE id = 'codex:session-1'`,
  )[0].values[0];
  assert.deepEqual(conversation, [
    'C:/new-path/session-1.jsonl',
    999,
    '2026-05-21T00:00:00Z',
    'codex@test2',
    'repo-renamed',
    'C:/repo-renamed',
    'dev',
  ]);
});

test('ingestRemoteImport upgrades legacy local rows instead of duplicating them', () => {
  resetDatabase(db);
  db.run(
    `INSERT INTO conversations (
      id, source, project_dir, project_name, message_count,
      first_message_at, last_message_at, file_path, file_size, file_mtime, status
    ) VALUES (
      'session-1', 'codex', 'C:/repo', 'repo', 2,
      '2026-05-20T00:00:00Z', '2026-05-20T00:01:00Z',
      'C:/fixtures/session-1.jsonl', 10, '2026-05-20T00:00:00Z', 'imported'
    )`,
  );

  const first = ingest.ingestRemoteImport({ version: 1, items: [remoteItem('session-1')] });
  const second = ingest.ingestRemoteImport({ version: 1, items: [remoteItem('session-1')] });
  const conversations = db.exec(
    `SELECT id, source_conversation_id, parser_version FROM conversations ORDER BY id`,
  )[0]?.values ?? [];
  const messageConversationIds = db.exec(
    `SELECT DISTINCT conversation_id FROM messages ORDER BY conversation_id`,
  )[0]?.values ?? [];

  assert.equal(first.replaced, 1);
  assert.equal(second.skipped, 1);
  assert.deepEqual(conversations, [['session-1', 'session-1', 'codex@test']]);
  assert.deepEqual(messageConversationIds, [['session-1']]);
});

test('ingestRemoteImport replaces changed content and deletes unedited imported notes', () => {
  resetDatabase(db);
  ingest.ingestRemoteImport({ version: 1, items: [remoteItem('session-1')] });
  db.run(
    `INSERT INTO notes (id, conversation_id, title, summary, key_conclusions, code_snippets, is_edited, source_type)
     VALUES (1, 'codex:session-1', 'generated', 'old', '[]', '[]', 0, 'imported-conversation')`,
  );

  const result = ingest.ingestRemoteImport({ version: 1, items: [remoteItem('session-1', 'changed')] });
  const notes = db.exec(
    `SELECT id, title FROM notes WHERE conversation_id = 'codex:session-1' ORDER BY id`,
  )[0]?.values ?? [];
  const cleanup = db.exec(
    `SELECT target_type, target_id FROM vector_cleanup_tasks ORDER BY id`,
  )[0]?.values ?? [];

  assert.equal(result.replaced, 1);
  assert.deepEqual(notes, []);
  assert.deepEqual(cleanup, [['note', '1']]);
});

test('ingestRemoteImport preserves edited imported notes during replacement', () => {
  resetDatabase(db);
  ingest.ingestRemoteImport({ version: 1, items: [remoteItem('session-1')] });
  db.run(
    `INSERT INTO notes (id, conversation_id, title, summary, key_conclusions, code_snippets, is_edited, source_type)
     VALUES (2, 'codex:session-1', 'edited', 'keep', '[]', '[]', 1, 'imported-conversation')`,
  );

  const result = ingest.ingestRemoteImport({ version: 1, items: [remoteItem('session-1', 'changed')] });
  const notes = db.exec(
    `SELECT id, title FROM notes WHERE conversation_id = 'codex:session-1' ORDER BY id`,
  )[0]?.values ?? [];
  const status = db.exec(
    `SELECT status FROM conversations WHERE id = 'codex:session-1'`,
  )[0].values[0][0];
  const cleanup = db.exec(
    `SELECT target_type, target_id FROM vector_cleanup_tasks ORDER BY id`,
  )[0]?.values ?? [];

  assert.equal(result.replaced, 1);
  assert.deepEqual(notes, [[2, 'edited']]);
  assert.equal(status, 'summarized');
  assert.deepEqual(cleanup, []);
});

test('ingestRemoteImport rejects tampered content hashes per item', () => {
  resetDatabase(db);
  const item = { ...remoteItem('session-1'), contentHash: '0'.repeat(64) };

  const result = ingest.ingestRemoteImport({ version: 1, items: [item] });

  assert.equal(result.errors, 1);
  assert.equal(result.items[0].status, 'error');
  assert.match(result.items[0].error ?? '', /content hash/i);
});
