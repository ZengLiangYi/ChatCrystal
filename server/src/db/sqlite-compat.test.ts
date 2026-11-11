import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { after } from 'node:test';
import { SqliteCompatDatabase, splitSqlStatements } from './sqlite-compat.js';

const fixtureRoot = mkdtempSync(join(tmpdir(), 'chatcrystal-sqlite-compat-'));
let opened = 0;

after(() => {
	rmSync(fixtureRoot, { recursive: true, force: true });
});

function openDatabase(label: string): SqliteCompatDatabase {
	opened++;
	return new SqliteCompatDatabase(join(fixtureRoot, `${label}-${opened}.db`));
}

test('splitSqlStatements splits on semicolons outside literals and comments', () => {
	assert.deepEqual(
		splitSqlStatements(`
      CREATE TABLE a (x TEXT DEFAULT 'semi;colon');
      -- a comment with ; inside
      INSERT INTO a VALUES ("ident;ifier");
      /* block ; comment */
      SELECT 1;
    `),
		[
			"CREATE TABLE a (x TEXT DEFAULT 'semi;colon')",
			'-- a comment with ; inside\n      INSERT INTO a VALUES ("ident;ifier")',
			'/* block ; comment */\n      SELECT 1',
		],
	);

	// Doubled quotes inside a literal do not end the literal early.
	assert.deepEqual(splitSqlStatements("SELECT 'it''s;fine'; SELECT 2"), [
		"SELECT 'it''s;fine'",
		'SELECT 2',
	]);

	// Bracket identifiers may contain semicolons.
	assert.deepEqual(splitSqlStatements('CREATE TABLE [a;b] (x); SELECT 1'), [
		'CREATE TABLE [a;b] (x)',
		'SELECT 1',
	]);
});

test('splitSqlStatements keeps CREATE TRIGGER bodies together', () => {
	const statements = splitSqlStatements(`
    CREATE TRIGGER trg AFTER INSERT ON t
    BEGIN
      UPDATE t SET n = n + 1;
      DELETE FROM u WHERE gone = 1;
    END;
    SELECT 1;
  `);
	assert.equal(statements.length, 2);
	assert.match(statements[0] ?? '', /CREATE TRIGGER[\s\S]*END/);
	assert.equal(statements[1], 'SELECT 1');

	// And the trigger really does execute as one statement through run().
	const db = openDatabase('trigger');
	try {
		db.exec('CREATE TABLE t (n INTEGER); CREATE TABLE u (gone INTEGER)');
		db.run(statements[0] as string);
		db.run('INSERT INTO t (n) VALUES (0)');
		assert.deepEqual(db.exec('SELECT n FROM t')[0]?.values, [[1]]);
	} finally {
		db.close();
	}
});

test('exec mirrors sql.js result shapes', () => {
	const db = openDatabase('exec');
	try {
		// Multi-statement DDL + DML runs; only row-returning statements appear.
		const results = db.exec(`
      CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, blob BLOB);
      INSERT INTO items (name, blob) VALUES ('first', x'010203');
      INSERT INTO items (name, blob) VALUES ('second', NULL);
      SELECT id, name FROM items ORDER BY id;
    `);
		assert.deepEqual(results, [
			{
				columns: ['id', 'name'],
				values: [
					[1, 'first'],
					[2, 'second'],
				],
			},
		]);
		assert.equal(db.getRowsModified(), 1);

		// Zero-row statements produce no entry (sql.js behavior).
		assert.deepEqual(db.exec('SELECT * FROM items WHERE 0'), []);
		assert.deepEqual(db.exec('PRAGMA foreign_key_check'), []);
		assert.deepEqual(db.exec('PRAGMA table_info(items)').length, 1);

		// Parameters, positional and named (with sql.js prefixes).
		assert.deepEqual(db.exec('SELECT name FROM items WHERE id = ?', [2]), [
			{ columns: ['name'], values: [['second']] },
		]);
		assert.deepEqual(db.exec('SELECT name FROM items WHERE id = :id', { ':id': 1 }), [
			{ columns: ['name'], values: [['first']] },
		]);
		assert.deepEqual(db.exec('SELECT name FROM items WHERE id = $id', { id: 2 }), [
			{ columns: ['name'], values: [['second']] },
		]);

		// BLOB values come back as Uint8Array, like sql.js.
		const blob = db.exec('SELECT blob FROM items WHERE id = 1')[0]?.values[0]?.[0];
		assert.ok(blob instanceof Uint8Array);
		assert.deepEqual(Array.from(blob as Uint8Array), [1, 2, 3]);
	} finally {
		db.close();
	}
});

test('run executes multiple statements, binds params and is chainable', () => {
	const db = openDatabase('run');
	try {
		const returned = db.run(`
      CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
      INSERT INTO items (name) VALUES ('a');
      INSERT INTO items (name) VALUES ('b');
    `);
		assert.equal(returned, db);

		db.run('INSERT INTO items (name) VALUES (?)', ['c']);
		db.run('INSERT INTO items (name) VALUES (:name)', { name: 'd' });
		assert.deepEqual(db.exec('SELECT name FROM items ORDER BY id')[0]?.values, [
			['a'],
			['b'],
			['c'],
			['d'],
		]);

		db.run('DELETE FROM items WHERE name = ?', ['b']);
		assert.equal(db.getRowsModified(), 1);
		db.run('DELETE FROM items WHERE name = ?', ['missing']);
		assert.equal(db.getRowsModified(), 0);
	} finally {
		db.close();
	}
});

test('prepared statements support run(array), repeated use and free()', () => {
	const db = openDatabase('prepare');
	try {
		db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
		const insert = db.prepare('INSERT INTO items (name) VALUES (?)');
		try {
			assert.deepEqual(insert.getColumnNames(), []);
			insert.run(['one']);
			insert.run(['two']);
			insert.run([]);
		} finally {
			insert.free();
		}

		// An empty array binds nothing; unbound parameters are NULL.
		assert.deepEqual(db.exec('SELECT name FROM items ORDER BY id')[0]?.values, [
			['one'],
			['two'],
			[null],
		]);

		const update = db.prepare('UPDATE items SET name = ? WHERE id = ?');
		update.run(['two-updated', 2]);
		update.free();
		assert.equal(db.getRowsModified(), 1);
		assert.deepEqual(db.exec('SELECT name FROM items WHERE id = 2')[0]?.values, [
			['two-updated'],
		]);
	} finally {
		db.close();
	}
});

test('foreign keys are enforced on the connection', () => {
	const db = openDatabase('fk');
	try {
		db.exec(`
      CREATE TABLE parent (id INTEGER PRIMARY KEY);
      CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id) ON DELETE CASCADE);
    `);
		db.run('INSERT INTO parent (id) VALUES (1)');
		db.run('INSERT INTO child (id, parent_id) VALUES (10, 1)');
		assert.throws(() => db.run('INSERT INTO child (id, parent_id) VALUES (11, 999)'), /FOREIGN KEY/);
		assert.deepEqual(db.exec('PRAGMA foreign_keys')[0]?.values, [[1]]);
	} finally {
		db.close();
	}
});

test('export returns a usable database image with committed WAL data', () => {
	const db = openDatabase('export');
	try {
		db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
		db.run("INSERT INTO items (name) VALUES ('wal-content')");

		const image = db.export();
		assert.ok(image instanceof Uint8Array);
		assert.ok(image.length > 0);

		// The exported image is a real SQLite database that includes WAL writes.
		const copyPath = join(fixtureRoot, 'exported-copy.db');
		writeFileSync(copyPath, image);
		const reopened = new DatabaseSync(copyPath);
		try {
			const row = reopened.prepare('SELECT name FROM items').get() as
				| Record<string, unknown>
				| undefined;
			assert.equal(row?.name, 'wal-content');
		} finally {
			reopened.close();
		}
	} finally {
		db.close();
	}
});

test('checkpoint flushes the WAL and close releases the file handle', () => {
	const dbPath = join(fixtureRoot, 'wal-flush.db');
	const db = new SqliteCompatDatabase(dbPath);
	db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
	db.run("INSERT INTO items (name) VALUES ('before-save')");
	db.checkpoint();

	// After a checkpoint the main file alone holds the rows: a second
	// connection sees them without replaying this connection's WAL.
	const reader = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const row = reader.prepare('SELECT name FROM items').get() as
			| Record<string, unknown>
			| undefined;
		assert.equal(row?.name, 'before-save');
	} finally {
		reader.close();
	}

	db.close();
	db.close(); // idempotent

	// Closing released the handle, so the files can be removed (Windows lock
	// check) and the data survives a reopen.
	try {
		const reopened = new SqliteCompatDatabase(dbPath);
		try {
			assert.deepEqual(reopened.exec('SELECT name FROM items')[0]?.values, [
				['before-save'],
			]);
		} finally {
			reopened.close();
		}
	} finally {
		rmSync(dbPath, { force: true });
		rmSync(`${dbPath}-wal`, { force: true });
		rmSync(`${dbPath}-shm`, { force: true });
		assert.equal(existsSync(dbPath), false);
	}
});

test('operations after close fail loudly', () => {
	const db = openDatabase('closed');
	db.close();
	assert.throws(() => db.exec('SELECT 1'), /already closed/);
	assert.throws(() => db.run('SELECT 1'), /already closed/);
	assert.throws(() => db.prepare('SELECT 1'), /already closed/);
	assert.throws(() => db.export(), /already closed/);
});
