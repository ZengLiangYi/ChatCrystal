import initSqlJs, { type Database } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { appConfig } from '../config.js';
import { SCHEMA_SQL } from './schema.js';

let db: Database | null = null;

const DB_PATH = resolve(appConfig.dataDir, 'chatcrystal.db');

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
  db.exec(SCHEMA_SQL);

  // Migrate: add embedding_status column if missing (for existing DBs)
  const colCheck = db.exec("PRAGMA table_info(notes)");
  const columns = colCheck[0]?.values.map((row) => row[1] as string) ?? [];
  if (!columns.includes('embedding_status')) {
    db.run("ALTER TABLE notes ADD COLUMN embedding_status TEXT DEFAULT 'pending'");
    // Mark notes that already have embeddings as done
    db.run(`UPDATE notes SET embedding_status = 'done'
            WHERE id IN (SELECT DISTINCT note_id FROM embeddings)`);
    console.log('[DB] Migrated: added embedding_status column to notes');
  }

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
