import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import initSqlJs, { type Database } from 'sql.js';
import { applySchemaMigrations } from './index.js';

async function createDatabase(): Promise<Database> {
  const SQL = await initSqlJs({
    locateFile: (file) =>
      fileURLToPath(
        new URL(`../../../node_modules/sql.js/dist/${file}`, import.meta.url),
      ),
  });

  return new SQL.Database();
}

function getColumnNames(db: Database, table: string): string[] {
  const result = db.exec(`PRAGMA table_info(${table})`);
  return result[0]?.values.map((row) => String(row[1])) ?? [];
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
