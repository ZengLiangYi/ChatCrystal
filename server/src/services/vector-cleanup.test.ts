import { strict as assert } from 'node:assert';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import { SCHEMA_SQL } from '../db/schema.js';
import { locateSqlJsFile } from '../test-utils/sql.test-helper.js';
import {
  enqueueNoteVectorCleanupTask,
  processNoteVectorCleanupTask,
  processPendingVectorCleanupTasks,
} from './vector-cleanup.js';

async function createSqlDatabase() {
  const SQL = await initSqlJs({
    locateFile: locateSqlJsFile,
  });
  const db = new SQL.Database();
  db.exec(SCHEMA_SQL);
  return db;
}

function taskRows(db: Database) {
  return db.exec(
    `SELECT target_type, target_id, status, attempts, last_error
       FROM vector_cleanup_tasks
      ORDER BY id ASC`,
  )[0]?.values ?? [];
}

test('processNoteVectorCleanupTask keeps a failed note cleanup pending and a later retry removes it after the note row is gone', async () => {
  const db = await createSqlDatabase();
  let saves = 0;
  let calls = 0;

  enqueueNoteVectorCleanupTask(15, { db: db as never });

  await assert.rejects(
    processNoteVectorCleanupTask(15, {
      db: db as never,
      save: () => {
        saves++;
      },
      deleteNoteVectors: async (noteId) => {
        calls++;
        assert.equal(noteId, 15);
        throw new Error('vectra cleanup failed');
      },
    }),
    /vectra cleanup failed/,
  );

  assert.equal(calls, 1);
  assert.equal(saves, 1);
  assert.deepEqual(taskRows(db), [
    ['note', '15', 'pending', 1, 'vectra cleanup failed'],
  ]);

  const result = await processPendingVectorCleanupTasks({
    db: db as never,
    limit: 25,
    save: () => {
      saves++;
    },
    deleteNoteVectors: async (noteId) => {
      calls++;
      assert.equal(noteId, 15);
      return 3;
    },
  });

  assert.deepEqual(result, { attempted: 1, succeeded: 1, failed: 0, deleted: 3 });
  assert.equal(calls, 2);
  assert.equal(saves, 2);
  assert.deepEqual(taskRows(db), []);
});

test('processPendingVectorCleanupTasks continues after one cleanup task fails', async () => {
  const db = await createSqlDatabase();

  enqueueNoteVectorCleanupTask(21, { db: db as never });
  enqueueNoteVectorCleanupTask(22, { db: db as never });

  const result = await processPendingVectorCleanupTasks({
    db: db as never,
    limit: 10,
    save: () => undefined,
    deleteNoteVectors: async (noteId) => {
      if (noteId === 21) {
        throw new Error('first cleanup failed');
      }
      return 2;
    },
  });

  assert.deepEqual(result, { attempted: 2, succeeded: 1, failed: 1, deleted: 2 });
  assert.deepEqual(taskRows(db), [
    ['note', '21', 'pending', 1, 'first cleanup failed'],
  ]);
});
