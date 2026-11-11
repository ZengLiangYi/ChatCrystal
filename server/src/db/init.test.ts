import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Database } from 'sql.js';

const dataDir = mkdtempSync(join(tmpdir(), 'chatcrystal-init-db-test-'));
process.env.DATA_DIR = dataDir;

const dbService = await import('./index.js');

function getNumber(db: Database, sql: string): number {
  const result = db.exec(sql);
  return Number(result[0]?.values[0]?.[0] ?? 0);
}

test('initDatabase keeps foreign keys enabled after initial save', async () => {
  try {
    const db = await dbService.initDatabase();

    assert.equal(getNumber(db, 'PRAGMA foreign_keys'), 1);
  } finally {
    dbService.closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('initDatabase opens a file-backed WAL database that survives reopen', async () => {
  const dbPath = join(dataDir, 'chatcrystal.db');

  const db = await dbService.initDatabase();
  try {
    assert.ok(existsSync(dbPath), 'the database is a real file');
    assert.equal(
      String(db.exec('PRAGMA journal_mode')[0]?.values[0]?.[0]).toLowerCase(),
      'wal',
    );
    // NORMAL = 1; committed rows are durable without a full fsync per statement.
    assert.equal(getNumber(db, 'PRAGMA synchronous'), 1);

    db.run(
      "INSERT INTO import_log (file_path, status) VALUES ('fixture.jsonl', 'success')",
    );
    dbService.saveDatabase();
  } finally {
    dbService.closeDatabase();
  }

  // A fresh connection (the old saveDatabase serialized a whole in-memory DB;
  // now the WAL file itself holds the committed data).
  const reopened = await dbService.initDatabase();
  try {
    assert.equal(
      getNumber(
        reopened,
        "SELECT COUNT(*) FROM import_log WHERE file_path = 'fixture.jsonl'",
      ),
      1,
    );
  } finally {
    dbService.closeDatabase();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
