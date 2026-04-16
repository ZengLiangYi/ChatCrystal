import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { SCHEMA_SQL } from '../../db/schema.js';
import { ensureSyntheticOriginConversation } from './origin.js';

async function createDb() {
  const SQL = await initSqlJs({
    locateFile: (file) =>
      fileURLToPath(
        new URL(`../../../../node_modules/sql.js/dist/${file}`, import.meta.url),
      ),
  });
  const db = new SQL.Database();
  db.exec(SCHEMA_SQL);
  return db;
}

test('ensureSyntheticOriginConversation reuses an existing synthetic origin row', async () => {
  const db = await createDb();

  const firstId = ensureSyntheticOriginConversation(db as never, {
    originId: 'memory:auto:run-123',
    projectDir: 'C:/repo',
    projectName: 'repo',
    cwd: 'C:/repo',
    gitBranch: 'main',
  });
  const secondId = ensureSyntheticOriginConversation(db as never, {
    originId: 'memory:auto:run-123',
    projectDir: 'C:/repo',
    projectName: 'repo',
    cwd: 'C:/repo',
    gitBranch: 'main',
  });

  assert.equal(firstId, secondId);
});
