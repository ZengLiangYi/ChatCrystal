import initSqlJs, { type Database } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { backfillImportedNoteMetadata } from '../services/memory/backfill.js';
import { runtimePaths } from '../runtime/paths.js';
import { SCHEMA_SQL } from './schema.js';

let db: Database | null = null;

const DB_PATH = runtimePaths.dbPath;
const POST_MIGRATION_SQL = `
CREATE INDEX IF NOT EXISTS idx_notes_project_key ON notes(project_key);
`;

function ensureColumn(db: Database, table: string, column: string, sql: string) {
  const info = db.exec(`PRAGMA table_info(${table})`);
  const columns = info[0]?.values.map((row) => String(row[1])) ?? [];
  if (!columns.includes(column)) {
    db.run(sql);
  }
}

export function applySchemaMigrations(db: Database): void {
  db.exec(SCHEMA_SQL);

  ensureColumn(db, 'conversations', 'experience_score', 'ALTER TABLE conversations ADD COLUMN experience_score REAL');
  ensureColumn(db, 'conversations', 'experience_gate_reason', 'ALTER TABLE conversations ADD COLUMN experience_gate_reason TEXT');
  ensureColumn(db, 'conversations', 'experience_gate_details', 'ALTER TABLE conversations ADD COLUMN experience_gate_details TEXT');
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
}

export async function initDatabase(): Promise<Database> {
  if (db) return db;

  // Ensure data directory exists
  const dataDir = dirname(DB_PATH);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // In packaged Electron, WASM is in extraResources; otherwise use default from node_modules
  const sqlJsOptions = process.env.ELECTRON_PACKAGED
    ? { locateFile: () => join((process as NodeJS.Process & { resourcesPath: string }).resourcesPath, 'sql-wasm.wasm') }
    : undefined;
  const SQL = await initSqlJs(sqlJsOptions);

  // Load existing database or create new one
  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Enable WAL mode and foreign keys
  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA foreign_keys = ON;');

  // Run schema migration
  applySchemaMigrations(db);

  // Mark notes that already have embeddings as done
  db.run(`UPDATE notes SET embedding_status = 'done'
          WHERE id IN (SELECT DISTINCT note_id FROM embeddings)`);
  backfillImportedNoteMetadata(db);

  // Persist to disk
  saveDatabase();

  console.log(`[DB] Database initialized at ${DB_PATH}`);
  return db;
}

export function getDatabase(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function saveDatabase(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(DB_PATH, buffer);
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
  if (db) {
    saveDatabase();
    db.close();
    db = null;
    console.log('[DB] Database closed.');
  }
}
