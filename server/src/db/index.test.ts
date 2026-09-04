import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import { locateSqlJsFile } from '../test-utils/sql.test-helper.js';
import {
  applySchemaMigrations,
  exportDatabasePreservingForeignKeys,
} from './index.js';

async function createDatabase(): Promise<Database> {
  const SQL = await initSqlJs({
    locateFile: locateSqlJsFile,
  });

  return new SQL.Database();
}

function getColumnNames(db: Database, table: string): string[] {
  const result = db.exec(`PRAGMA table_info(${table})`);
  return result[0]?.values.map((row) => String(row[1])) ?? [];
}

function getIndexColumnNames(db: Database, indexName: string): string[] {
  const result = db.exec(`PRAGMA index_info('${indexName}')`);
  return result[0]?.values.map((row) => String(row[2])) ?? [];
}

function getNumber(db: Database, sql: string): number {
  const result = db.exec(sql);
  return Number(result[0]?.values[0]?.[0] ?? 0);
}

test('applySchemaMigrations upgrades legacy notes table before creating project_key index', async () => {
  const db = await createDatabase();

  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      slug TEXT,
      source TEXT NOT NULL DEFAULT 'claude-code',
      project_dir TEXT NOT NULL,
      project_name TEXT NOT NULL,
      cwd TEXT,
      git_branch TEXT,
      message_count INTEGER DEFAULT 0,
      first_message_at TEXT,
      last_message_at TEXT,
      file_path TEXT,
      file_size INTEGER,
      file_mtime TEXT,
      status TEXT DEFAULT 'imported',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      raw_llm_response TEXT
    );
  `);

  assert.deepEqual(getColumnNames(db, 'notes').includes('project_key'), false);

  applySchemaMigrations(db);

  assert.deepEqual(getColumnNames(db, 'notes').includes('project_key'), true);

  const indexRows = db.exec("PRAGMA index_list('notes')");
  const indexNames = indexRows[0]?.values.map((row) => String(row[1])) ?? [];
  assert.ok(indexNames.includes('idx_notes_project_key'));
});

test('applySchemaMigrations adds conversation experience gate audit columns', async () => {
  const db = await createDatabase();

  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      slug TEXT,
      source TEXT NOT NULL DEFAULT 'claude-code',
      project_dir TEXT NOT NULL,
      project_name TEXT NOT NULL,
      cwd TEXT,
      git_branch TEXT,
      message_count INTEGER DEFAULT 0,
      first_message_at TEXT,
      last_message_at TEXT,
      file_path TEXT,
      file_size INTEGER,
      file_mtime TEXT,
      status TEXT DEFAULT 'imported',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      raw_llm_response TEXT
    );
  `);

  applySchemaMigrations(db);

  const columns = getColumnNames(db, 'conversations');
  assert.ok(columns.includes('experience_score'));
  assert.ok(columns.includes('experience_gate_reason'));
  assert.ok(columns.includes('experience_gate_details'));
});

test('applySchemaMigrations backfills remote import identity columns for legacy conversations', async () => {
  const db = await createDatabase();

  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      slug TEXT,
      source TEXT NOT NULL DEFAULT 'claude-code',
      project_dir TEXT NOT NULL,
      project_name TEXT NOT NULL,
      cwd TEXT,
      git_branch TEXT,
      message_count INTEGER DEFAULT 0,
      first_message_at TEXT,
      last_message_at TEXT,
      file_path TEXT,
      file_size INTEGER,
      file_mtime TEXT,
      status TEXT DEFAULT 'imported',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    INSERT INTO conversations (
      id, source, project_dir, project_name, first_message_at, last_message_at, file_path
    ) VALUES
      ('session-1', 'codex', 'C:/repo', 'repo', '2026-05-20', '2026-05-20', 'a.jsonl'),
      ('codex:session-2', 'codex', 'C:/repo', 'repo', '2026-05-20', '2026-05-20', 'b.jsonl');
  `);

  applySchemaMigrations(db);

  const rows = db.exec(
    `SELECT id, source_conversation_id, parser_version
       FROM conversations
      ORDER BY id ASC`,
  )[0].values;

  assert.deepEqual(rows, [
    ['codex:session-2', 'session-2', 'codex@1'],
    ['session-1', 'session-1', 'codex@1'],
  ]);
});

test('applySchemaMigrations converts confirmed low-signal errors to filtered', async () => {
  const db = await createDatabase();

  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      slug TEXT,
      source TEXT NOT NULL DEFAULT 'claude-code',
      project_dir TEXT NOT NULL,
      project_name TEXT NOT NULL,
      cwd TEXT,
      git_branch TEXT,
      message_count INTEGER DEFAULT 0,
      first_message_at TEXT,
      last_message_at TEXT,
      file_path TEXT,
      file_size INTEGER,
      file_mtime TEXT,
      status TEXT DEFAULT 'imported',
      experience_score REAL,
      experience_gate_reason TEXT,
      experience_gate_details TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      raw_llm_response TEXT
    );

    INSERT INTO conversations (
      id, source, project_dir, project_name, first_message_at, last_message_at,
      file_path, status, experience_gate_reason
    ) VALUES
      ('low-signal-error', 'codex', 'C:/repo', 'repo', '2026-04-29', '2026-04-29', 'a.jsonl', 'error', 'low-signal'),
      ('provider-error', 'codex', 'C:/repo', 'repo', '2026-04-29', '2026-04-29', 'b.jsonl', 'error', 'provider-error');
  `);

  applySchemaMigrations(db);

  const rows = db.exec(
    'SELECT id, status FROM conversations ORDER BY id ASC',
  )[0].values;

  assert.deepEqual(rows, [
    ['low-signal-error', 'filtered'],
    ['provider-error', 'error'],
  ]);
});

test('applySchemaMigrations creates experience review table and indexes', async () => {
  const db = await createDatabase();

  applySchemaMigrations(db);

  const columns = getColumnNames(db, 'experience_reviews');
  assert.deepEqual(columns, [
    'id',
    'target_type',
    'target_id',
    'conversation_id',
    'note_id',
    'verdict',
    'reason',
    'comment',
    'source',
    'gate_score',
    'gate_reason',
    'gate_details',
    'created_at',
  ]);

  const indexRows = db.exec("PRAGMA index_list('experience_reviews')");
  const indexNames = indexRows[0]?.values.map((row) => String(row[1])) ?? [];
  assert.ok(indexNames.includes('idx_experience_reviews_target'));
  assert.ok(indexNames.includes('idx_experience_reviews_conversation'));
  assert.ok(indexNames.includes('idx_experience_reviews_verdict'));
});

test('applySchemaMigrations creates vector cleanup task table and indexes', async () => {
  const db = await createDatabase();

  applySchemaMigrations(db);

  const columns = getColumnNames(db, 'vector_cleanup_tasks');
  assert.deepEqual(columns, [
    'id',
    'target_type',
    'target_id',
    'status',
    'attempts',
    'last_error',
    'created_at',
    'updated_at',
  ]);

  const indexRows = db.exec("PRAGMA index_list('vector_cleanup_tasks')");
  const indexes = indexRows[0]?.values ?? [];
  const indexNames = indexes.map((row) => String(row[1]));
  assert.ok(indexNames.includes('idx_vector_cleanup_tasks_pending'));
  assert.ok(indexes.some((row) => Number(row[2]) === 1));
  const pendingIndexColumns = db.exec(
    "PRAGMA index_info('idx_vector_cleanup_tasks_pending')",
  )[0].values.map((row) => String(row[2]));
  assert.deepEqual(pendingIndexColumns, ['status', 'updated_at', 'id']);

  db.run(
    "INSERT INTO vector_cleanup_tasks (target_type, target_id) VALUES ('note', '42')",
  );
  assert.throws(() => {
    db.run(
      "INSERT INTO vector_cleanup_tasks (target_type, target_id) VALUES ('note', '42')",
    );
  }, /UNIQUE/);
});

test('applySchemaMigrations repairs legacy vector cleanup pending index shape', async () => {
  const db = await createDatabase();

  db.exec(`
    CREATE TABLE vector_cleanup_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(target_type, target_id)
    );

    CREATE INDEX idx_vector_cleanup_tasks_pending
      ON vector_cleanup_tasks(status, updated_at);
  `);

  assert.deepEqual(getIndexColumnNames(db, 'idx_vector_cleanup_tasks_pending'), [
    'status',
    'updated_at',
  ]);

  applySchemaMigrations(db);

  assert.deepEqual(getIndexColumnNames(db, 'idx_vector_cleanup_tasks_pending'), [
    'status',
    'updated_at',
    'id',
  ]);
});

test('applySchemaMigrations removes orphan tags and orphan note tag links', async () => {
  const db = await createDatabase();

  db.exec('PRAGMA foreign_keys = ON');
  applySchemaMigrations(db);

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

    INSERT INTO tags (id, name) VALUES
      (1, 'used'),
      (2, 'unused'),
      (3, 'orphan-link');

    INSERT INTO note_tags (note_id, tag_id) VALUES (1, 1);
  `);

  db.exec('PRAGMA foreign_keys = OFF');
  db.run('INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)', [999, 3]);
  db.exec('PRAGMA foreign_keys = ON');

  applySchemaMigrations(db);

  assert.deepEqual(db.exec('SELECT id, name FROM tags ORDER BY id ASC')[0].values, [
    [1, 'used'],
  ]);
  assert.deepEqual(db.exec('SELECT note_id, tag_id FROM note_tags')[0].values, [
    [1, 1],
  ]);
  assert.deepEqual(db.exec('PRAGMA foreign_key_check')[0]?.values ?? [], []);
});

test('experience review rows remain after deleting reviewed note', async () => {
  const db = await createDatabase();

  db.exec('PRAGMA foreign_keys = ON');
  applySchemaMigrations(db);

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
      1, 'conversation-1', 'Low value note', 'This note should be deleted.'
    );

    INSERT INTO experience_reviews (
      target_type, target_id, conversation_id, note_id, verdict, reason, source
    ) VALUES (
      'note', '1', 'conversation-1', 1, 'false_accept', 'not-experience', 'cli'
    );

    DELETE FROM notes WHERE id = 1;
  `);

  const rows = db.exec(
    'SELECT note_id, target_id FROM experience_reviews ORDER BY id ASC',
  )[0]?.values ?? [];

  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], null);
  assert.equal(rows[0][1], '1');
});

test('exportDatabasePreservingForeignKeys keeps note deletion cascades active after export', async () => {
  const db = await createDatabase();

  db.exec('PRAGMA foreign_keys = ON');
  applySchemaMigrations(db);

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
      1, 'conversation-1', 'Low value note', 'This note should be deleted.'
    );

    INSERT INTO embeddings (note_id, chunk_index, chunk_text, vectra_id)
    VALUES (1, 0, 'chunk text', 'vectra-1');

    INSERT INTO tags (id, name) VALUES (1, 'quality');
    INSERT INTO note_tags (note_id, tag_id) VALUES (1, 1);

    INSERT INTO writeback_receipts (
      source_agent, source_run_key, decision, note_id, reason
    ) VALUES (
      'codex', 'run-1', 'created', 1, 'seed'
    );

    INSERT INTO experience_reviews (
      target_type, target_id, conversation_id, note_id, verdict, reason, source
    ) VALUES (
      'note', '1', 'conversation-1', 1, 'false_accept', 'not-experience', 'cli'
    );
  `);

  assert.equal(getNumber(db, 'PRAGMA foreign_keys'), 1);

  const data = exportDatabasePreservingForeignKeys(db);

  assert.ok(data.length > 0);
  assert.equal(getNumber(db, 'PRAGMA foreign_keys'), 1);

  db.run('DELETE FROM notes WHERE id = 1');

  assert.equal(getNumber(db, 'SELECT COUNT(*) FROM embeddings WHERE note_id = 1'), 0);
  assert.equal(getNumber(db, 'SELECT COUNT(*) FROM note_tags WHERE note_id = 1'), 0);
  assert.equal(
    getNumber(db, 'SELECT COUNT(*) FROM writeback_receipts WHERE note_id = 1'),
    0,
  );
  assert.equal(
    getNumber(db, 'SELECT COUNT(*) FROM experience_reviews WHERE note_id = 1'),
    0,
  );

  const writebackRows =
    db.exec('SELECT note_id FROM writeback_receipts ORDER BY id ASC')[0]?.values ??
    [];
  const reviewRows =
    db.exec('SELECT note_id, target_id FROM experience_reviews ORDER BY id ASC')[0]
      ?.values ?? [];

  assert.deepEqual(writebackRows, [[null]]);
  assert.deepEqual(reviewRows, [[null, '1']]);
  assert.deepEqual(db.exec('PRAGMA foreign_key_check')[0]?.values ?? [], []);
});
