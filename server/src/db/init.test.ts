import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
