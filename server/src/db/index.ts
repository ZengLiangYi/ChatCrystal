/**
 * Database lifecycle for the server.
 *
 * The database is a real file-backed SQLite database (`node:sqlite`
 * `DatabaseSync`) in WAL mode. `sqlite-compat.ts` mirrors the sql.js API the
 * codebase uses (`exec`/`run`/`prepare`/`export`/`getRowsModified`), so every
 * caller keeps receiving the same sql.js-typed `Database` while reads and
 * writes go straight to disk. `saveDatabase()` is now a WAL checkpoint instead
 * of serializing the whole in-memory database to `chatcrystal.db`.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Database } from 'sql.js';
import { backfillImportedNoteMetadata } from '../services/memory/backfill.js';
import { runtimePaths } from '../runtime/paths.js';
import { cleanupOrphanTags } from './cleanup.js';
import { SCHEMA_SQL } from './schema.js';
import { SqliteCompatDatabase } from './sqlite-compat.js';

let db: Database | null = null;
/** The real node:sqlite connection behind `db`, for checkpoint/close. */
let sqlite: SqliteCompatDatabase | null = null;

const DB_PATH = runtimePaths.dbPath;
const POST_MIGRATION_SQL = `
CREATE INDEX IF NOT EXISTS idx_notes_project_key ON notes(project_key);
`;
const VECTOR_CLEANUP_PENDING_INDEX_SQL = `
CREATE INDEX idx_vector_cleanup_tasks_pending
  ON vector_cleanup_tasks(status, updated_at, id);
`;

function ensureColumn(db: Database, table: string, column: string, sql: string) {
  const info = db.exec(`PRAGMA table_info(${table})`);
  const columns = info[0]?.values.map((row) => String(row[1])) ?? [];
  if (!columns.includes(column)) {
    db.run(sql);
  }
}

function ensureIndexColumns(
  db: Database,
  indexName: string,
  expectedColumns: string[],
  createSql: string,
) {
  const info = db.exec(`PRAGMA index_info('${indexName}')`);
  const columns = info[0]?.values.map((row) => String(row[2])) ?? [];
  const isCurrent =
    columns.length === expectedColumns.length &&
    columns.every((column, index) => column === expectedColumns[index]);

  if (!isCurrent) {
    db.run(`DROP INDEX IF EXISTS ${indexName}`);
    db.run(createSql);
  }
}

export function applySchemaMigrations(db: Database): void {
  db.exec(SCHEMA_SQL);

  ensureColumn(db, 'conversations', 'experience_score', 'ALTER TABLE conversations ADD COLUMN experience_score REAL');
  ensureColumn(db, 'conversations', 'experience_gate_reason', 'ALTER TABLE conversations ADD COLUMN experience_gate_reason TEXT');
  ensureColumn(db, 'conversations', 'experience_gate_details', 'ALTER TABLE conversations ADD COLUMN experience_gate_details TEXT');
  ensureColumn(db, 'conversations', 'source_conversation_id', 'ALTER TABLE conversations ADD COLUMN source_conversation_id TEXT');
  ensureColumn(db, 'conversations', 'content_hash', 'ALTER TABLE conversations ADD COLUMN content_hash TEXT');
  ensureColumn(db, 'conversations', 'parser_version', 'ALTER TABLE conversations ADD COLUMN parser_version TEXT');
  db.run(
    `UPDATE conversations
        SET source_conversation_id = CASE
          WHEN id LIKE source || ':%' THEN substr(id, length(source) + 2)
          ELSE id
        END
      WHERE source_conversation_id IS NULL OR trim(source_conversation_id) = ''`,
  );
  db.run(
    `UPDATE conversations
        SET parser_version = source || '@1'
      WHERE parser_version IS NULL OR trim(parser_version) = ''`,
  );
  ensureColumn(db, 'notes', 'embedding_status', "ALTER TABLE notes ADD COLUMN embedding_status TEXT DEFAULT 'pending'");
  ensureColumn(db, 'notes', 'project_key', 'ALTER TABLE notes ADD COLUMN project_key TEXT');
  ensureColumn(db, 'notes', 'scope', "ALTER TABLE notes ADD COLUMN scope TEXT DEFAULT 'project'");
  ensureColumn(db, 'notes', 'source_type', "ALTER TABLE notes ADD COLUMN source_type TEXT DEFAULT 'imported-conversation'");
  ensureColumn(db, 'notes', 'source_agent', "ALTER TABLE notes ADD COLUMN source_agent TEXT DEFAULT 'unknown'");
  ensureColumn(db, 'notes', 'task_kind', 'ALTER TABLE notes ADD COLUMN task_kind TEXT');
  ensureColumn(db, 'notes', 'error_signatures', 'ALTER TABLE notes ADD COLUMN error_signatures TEXT');
  ensureColumn(db, 'notes', 'files_touched', 'ALTER TABLE notes ADD COLUMN files_touched TEXT');
  ensureColumn(db, 'notes', 'outcome_type', 'ALTER TABLE notes ADD COLUMN outcome_type TEXT');
  ensureColumn(
    db,
    'writeback_receipts',
    'index_status',
    "ALTER TABLE writeback_receipts ADD COLUMN index_status TEXT DEFAULT 'pending'",
  );

  db.run(
    `UPDATE conversations
        SET status = 'filtered',
            updated_at = datetime('now')
      WHERE status = 'error'
        AND lower(coalesce(experience_gate_reason, '')) IN (
          'low-signal',
          'filtered',
          'no reusable experience',
          'no-reusable-experience'
        )`,
  );

  db.exec(POST_MIGRATION_SQL);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_source_conversation_id
      ON conversations(source, source_conversation_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_content_hash
      ON conversations(content_hash);
    CREATE INDEX IF NOT EXISTS idx_note_relations_type_confidence
      ON note_relations(relation_type, confidence);
    CREATE INDEX IF NOT EXISTS idx_note_relations_confidence
      ON note_relations(confidence);
    CREATE INDEX IF NOT EXISTS idx_note_tags_note
      ON note_tags(note_id);
    CREATE INDEX IF NOT EXISTS idx_notes_graph_metadata
      ON notes(source_type, outcome_type, task_kind);
  `);
  ensureIndexColumns(
    db,
    'idx_vector_cleanup_tasks_pending',
    ['status', 'updated_at', 'id'],
    VECTOR_CLEANUP_PENDING_INDEX_SQL,
  );
  cleanupOrphanTags(db);
}

export async function initDatabase(): Promise<Database> {
  if (db) return db;

  // Ensure data directory exists
  const dataDir = dirname(DB_PATH);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // A real file-backed SQLite connection (WAL mode) instead of the old
  // in-memory sql.js database that was serialized to disk on every save.
  const compat = new SqliteCompatDatabase(DB_PATH);
  const activeDb = compat as unknown as Database;

  // Publish the connection before running migrations/backfill, so anything they
  // reach through getDatabase() sees an initialized database (same ordering as
  // the previous in-memory implementation).
  db = activeDb;
  sqlite = compat;

  try {
    // Run schema migration
    applySchemaMigrations(activeDb);

    // Mark notes that already have embeddings as done
    activeDb.run(`UPDATE notes SET embedding_status = 'done'
            WHERE id IN (SELECT DISTINCT note_id FROM embeddings)`);
    backfillImportedNoteMetadata(activeDb);
  } catch (error) {
    // Never leave a half-initialized connection holding the database file.
    db = null;
    sqlite = null;
    compat.close();
    throw error;
  }

  // Flush the startup writes into the main database file.
  saveDatabase();

  console.log(`[DB] Database initialized at ${DB_PATH} (node:sqlite, WAL)`);
  return db;
}

export function getDatabase(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function exportDatabasePreservingForeignKeys(activeDb: Database): Uint8Array {
  try {
    return activeDb.export();
  } finally {
    // sql.js export resets connection pragmas, so restore the invariant used by deletions.
    // (The node:sqlite compatibility export leaves the connection untouched, so
    // this is a no-op for the real file-backed database.)
    activeDb.run('PRAGMA foreign_keys = ON;');
  }
}

/**
 * Persist pending writes. With a file-backed WAL database the committed rows are
 * already durable, so a save only flushes the WAL into the main database file
 * (replacing the old full-database serialization).
 */
export function saveDatabase(): void {
  if (!sqlite) return;
  sqlite.checkpoint();
}

/** Auto-save to disk periodically */
let saveInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoSave(intervalMs = 30_000): void {
  if (saveInterval) return;
  saveInterval = setInterval(() => saveDatabase(), intervalMs);
}

export function stopAutoSave(): void {
  if (saveInterval) {
    clearInterval(saveInterval);
    saveInterval = null;
  }
}

export function closeDatabase(): void {
  stopAutoSave();
  if (sqlite) {
    // Checkpoints the WAL and releases the file handle (needed on Windows so a
    // removed temp data dir is not left locked).
    sqlite.close();
    sqlite = null;
    db = null;
    console.log('[DB] Database closed.');
    return;
  }
  if (db) {
    db.close();
    db = null;
  }
}
