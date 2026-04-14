import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { withTransaction } from './transaction.js';

async function createDatabase() {
  const SQL = await initSqlJs({
    locateFile: (file) =>
      fileURLToPath(
        new URL(`../../../node_modules/sql.js/dist/${file}`, import.meta.url),
      ),
  });

  const db = new SQL.Database();
  db.run('CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)');
  return db;
}

function getValues(db: Awaited<ReturnType<typeof createDatabase>>): string[] {
  const result = db.exec('SELECT value FROM items ORDER BY id');
  if (!result.length) {
    return [];
  }
  return result[0].values.map((row) => String(row[0]));
}

test('withTransaction commits all changes on success', async () => {
  const db = await createDatabase();

  withTransaction(db, () => {
    db.run('INSERT INTO items (value) VALUES (?)', ['first']);
    db.run('INSERT INTO items (value) VALUES (?)', ['second']);
  });

  assert.deepEqual(getValues(db), ['first', 'second']);
});

test('withTransaction rolls back all changes on error', async () => {
  const db = await createDatabase();

  assert.throws(() => {
    withTransaction(db, () => {
      db.run('INSERT INTO items (value) VALUES (?)', ['first']);
      throw new Error('boom');
    });
  }, /boom/);

  assert.deepEqual(getValues(db), []);
});

test('nested rollback preserves outer transaction work', async () => {
  const db = await createDatabase();

  withTransaction(db, () => {
    db.run('INSERT INTO items (value) VALUES (?)', ['outer-before']);

    assert.throws(() => {
      withTransaction(db, () => {
        db.run('INSERT INTO items (value) VALUES (?)', ['inner-fail']);
        throw new Error('inner boom');
      });
    }, /inner boom/);

    db.run('INSERT INTO items (value) VALUES (?)', ['outer-after']);
  });

  assert.deepEqual(getValues(db), ['outer-before', 'outer-after']);
});

test('nested rollback can be followed by a second nested success', async () => {
  const db = await createDatabase();

  withTransaction(db, () => {
    assert.throws(() => {
      withTransaction(db, () => {
        db.run('INSERT INTO items (value) VALUES (?)', ['inner-fail']);
        throw new Error('inner boom');
      });
    }, /inner boom/);

    withTransaction(db, () => {
      db.run('INSERT INTO items (value) VALUES (?)', ['inner-success']);
    });
  });

  assert.deepEqual(getValues(db), ['inner-success']);
});
