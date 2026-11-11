/**
 * sql.js → node:sqlite compatibility layer.
 *
 * The server's persistence used to be a whole in-memory sql.js (WASM) database
 * that was serialized to `chatcrystal.db` on every save. It now uses Electron's
 * / Node's built-in `node:sqlite` (`DatabaseSync`), i.e. a real file-backed
 * SQLite connection in WAL mode. Everything above `db/index.ts` still talks to
 * the small sql.js API surface the codebase grew up with, so this class mirrors
 * that surface on top of `DatabaseSync`:
 *
 *   db.exec(sql, params?)   → [{ columns, values }]  (only row-returning statements with rows)
 *   db.run(sql, params?)    → this                   (multi-statement allowed)
 *   db.prepare(sql)         → { run(params), free() } (+ column helpers)
 *   db.getRowsModified()    → rows changed by the last run statement
 *   db.export()             → Uint8Array of the current database image
 *   db.close()              → checkpoint WAL, close the file
 *
 * Behavioral notes (kept in sync with sql.js so existing callers stay valid):
 * - `exec()` returns one entry per *row-returning* statement that produced at
 *   least one row, like sql.js; DDL/DML/pragma setters produce no entry.
 * - `exec()`/`run()` accept multiple statements in one string. Statements are
 *   split here (sql.js loops over statements internally); the splitter respects
 *   SQL strings, identifiers and comments, plus `CREATE TRIGGER … BEGIN …; END;`
 *   bodies.
 * - Parameters may be a positional array (bound with `?`) or a named object.
 *   sql.js accepts the `:`/`$`/`@` prefixes in object keys, while node:sqlite
 *   wants bare names, so the prefixes are stripped here.
 * - `export()` uses `DatabaseSync.serialize()`, which yields a consistent
 *   database image including committed WAL content. The server no longer saves
 *   by exporting (a WAL checkpoint is enough); this exists for the public
 *   `exportDatabasePreservingForeignKeys()` API and for tests.
 */

import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

export type SqlValue = null | number | bigint | string | Uint8Array;

/** Positional (`?`) or named (`:name`) statement parameters. */
export type SqlBindParams = readonly SqlValue[] | Readonly<Record<string, SqlValue>>;

/** The subset of sql.js' `QueryExecResult` the server relies on. */
export interface SqlExecResult {
	columns: string[];
	values: SqlValue[][];
}

type SqliteStatement = ReturnType<DatabaseSync["prepare"]>;

interface StatementRunResult {
	changes: number | bigint;
	lastInsertRowid: number | bigint;
}

/** A prepared statement with the methods the server uses on the main DB. */
export interface CompatStatement {
	/** Execute with positional-array or named-object parameters. */
	run(params?: SqlBindParams): void;
	/** sql.js requires freeing statements; node:sqlite statements are GC-managed. */
	free(): void;
	/** Column names of a row-returning statement ([] for DDL/DML). */
	getColumnNames(): string[];
}

const TRIGGER_STATEMENT_PATTERN = /^\s*CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/i;

/**
 * Split a SQL string into individual statements, honoring string literals,
 * quoted identifiers, brackets and comments. `CREATE TRIGGER … BEGIN … END;`
 * bodies keep their internal semicolons.
 */
export function splitSqlStatements(sql: string): string[] {
	const statements: string[] = [];
	let start = 0;
	let index = 0;
	const length = sql.length;

	while (index < length) {
		const char = sql[index];

		// -- line comment
		if (char === "-" && sql[index + 1] === "-") {
			index += 2;
			while (index < length && sql[index] !== "\n") index++;
			continue;
		}

		// /* block comment */
		if (char === "/" && sql[index + 1] === "*") {
			index += 2;
			while (index + 1 < length && !(sql[index] === "*" && sql[index + 1] === "/")) {
				index++;
			}
			index = Math.min(index + 2, length);
			continue;
		}

		// 'string', "identifier", `identifier`
		if (char === "'" || char === '"' || char === "`") {
			const quote = char;
			index++;
			while (index < length) {
				if (sql[index] === quote) {
					if (sql[index + 1] === quote) {
						index += 2; // doubled quote inside the literal
						continue;
					}
					index++;
					break;
				}
				index++;
			}
			continue;
		}

		// [bracketed identifier]
		if (char === "[") {
			index++;
			while (index < length && sql[index] !== "]") index++;
			if (index < length) index++;
			continue;
		}

		if (char === ";") {
			const candidate = sql.slice(start, index).trim();
			// `CREATE TRIGGER … BEGIN …; END;` keeps its internal semicolons
			// until the terminating END.
			if (
				TRIGGER_STATEMENT_PATTERN.test(candidate) &&
				!/\bEND\s*$/i.test(candidate)
			) {
				index++;
				continue;
			}
			if (hasExecutableSql(candidate)) statements.push(candidate);
			index++;
			start = index;
			continue;
		}

		index++;
	}

	const tail = sql.slice(start).trim();
	if (hasExecutableSql(tail)) statements.push(tail);
	return statements;
}

/**
 * Whether a statement chunk contains anything besides whitespace/comments.
 * Only used on the (already trimmed) pieces between semicolons, so a simple
 * comment strip is enough here — comment markers cannot hide inside a string
 * that has already been split off correctly.
 */
function hasExecutableSql(statement: string): boolean {
	if (!statement) return false;
	const withoutComments = statement
		.replace(/--[^\n]*/g, " ")
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.trim();
	return withoutComments.length > 0;
}

/** Bind positional parameters the way node:sqlite expects them. */
function toInputValues(params: readonly SqlValue[]): SQLInputValue[] {
	return params as unknown as SQLInputValue[];
}

/** Strip sql.js' `:`/`$`/`@` prefixes from named parameter keys. */
function toNamedParams(
	params: Readonly<Record<string, SqlValue>>,
): Record<string, SQLInputValue> {
	const named: Record<string, SQLInputValue> = {};
	for (const [key, value] of Object.entries(params)) {
		const bareKey = key.replace(/^[:@$]/, "");
		named[bareKey] = value as SQLInputValue;
	}
	return named;
}

function isEmptyParams(params: SqlBindParams | null | undefined): boolean {
	if (params === null || params === undefined) return true;
	return Array.isArray(params) && params.length === 0;
}

export class SqliteCompatDatabase {
	private readonly handle: DatabaseSync;
	private closed = false;
	private lastRowsModified = 0;

	readonly filePath: string;

	constructor(filePath: string) {
		this.filePath = filePath;
		this.handle = new DatabaseSync(filePath);

		// Real file + WAL: writes are durable per transaction and a save is a
		// cheap checkpoint instead of serializing the whole database.
		this.handle.exec("PRAGMA journal_mode = WAL");
		this.handle.exec("PRAGMA synchronous = NORMAL");
		this.handle.exec("PRAGMA foreign_keys = ON");
	}

	/** sql.js-compatible `Database.exec(sql, params)`. */
	exec(sql: string, params?: SqlBindParams | null): SqlExecResult[] {
		this.assertOpen();

		if (!isEmptyParams(params)) {
			return this.execWithParams(sql, params as SqlBindParams);
		}

		const results: SqlExecResult[] = [];
		for (const statementSql of splitSqlStatements(sql)) {
			results.push(...this.execPrepared(statementSql));
		}
		return results;
	}

	/** sql.js-compatible `Database.run(sql, params)`; chainable like sql.js. */
	run(sql: string, params?: SqlBindParams | null): this {
		this.assertOpen();

		const statements = splitSqlStatements(sql);
		statements.forEach((statementSql, index) => {
			const statement = this.handle.prepare(statementSql);
			const columnCount = statement.columns().length;
			// sql.js binds the given params to every statement of a run(); the
			// server only ever passes params for a single-statement run, so bind
			// them to the first statement and run the rest bare.
			const bind: SqlBindParams | null =
				index === 0 && !isEmptyParams(params)
					? (params as SqlBindParams)
					: null;

			if (columnCount > 0) {
				// A row-returning statement executed through run(): discard rows.
				this.runPrepared(statement, bind, false);
			} else {
				this.runPrepared(statement, bind, true);
			}
		});
		return this;
	}

	/** sql.js-compatible `Database.prepare(sql)`. */
	prepare(sql: string): CompatStatement {
		this.assertOpen();
		const statement = this.handle.prepare(sql);
		const columnNames = statement.columns().map((column) => column.name);
		// Statements are GC-managed by node:sqlite; run/free only need `this`.
		const database = this;

		return {
			run(params?: SqlBindParams): void {
				database.assertOpen();
				const bind: SqlBindParams | null = isEmptyParams(params)
					? null
					: (params as SqlBindParams);
				database.runPrepared(statement, bind, columnNames.length === 0);
			},
			free(): void {
				// node:sqlite owns/finalizes prepared statements itself.
			},
			getColumnNames(): string[] {
				return [...columnNames];
			},
		};
	}

	/** Rows changed by the last statement run (sql.js `getRowsModified`). */
	getRowsModified(): number {
		return this.lastRowsModified;
	}

	/**
	 * A consistent image of the current database (including committed WAL
	 * content) as a fresh `Uint8Array`.
	 */
	export(): Uint8Array {
		this.assertOpen();
		const serialized = this.handle.serialize();
		const copy = new Uint8Array(serialized.length);
		copy.set(serialized);
		return copy;
	}

	/** Flush the WAL into the main database file. Cheap, does not rewrite it. */
	checkpoint(): void {
		this.assertOpen();
		try {
			this.handle.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		} catch {
			// A busy reader (or an open transaction) keeps the WAL as-is; the
			// next checkpoint or close() will flush it.
		}
	}

	/** Checkpoint the WAL and release the file handle (idempotent). */
	close(): void {
		if (this.closed) return;
		this.closed = true;
		try {
			this.handle.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		} catch {
			// The WAL is still valid on disk; closing flushes what SQLite can.
		}
		this.handle.close();
	}

	private assertOpen(): void {
		if (this.closed) {
			throw new Error(`Database at ${this.filePath} is already closed`);
		}
	}

	private execWithParams(sql: string, params: SqlBindParams): SqlExecResult[] {
		const results: SqlExecResult[] = [];
		const statements = splitSqlStatements(sql);

		statements.forEach((statementSql, index) => {
			const statement = this.handle.prepare(statementSql);
			const columns = statement.columns();
			const bind = index === 0 ? params : null;

			if (columns.length > 0) {
				const rows = this.allRows(statement, bind);
				if (rows.length > 0) {
					results.push({
						columns: columns.map((column) => column.name),
						values: rows,
					});
				}
				return;
			}

			const outcome = this.runPrepared(statement, bind, true);
			if (outcome.rowsModified > 0) {
				this.lastRowsModified = outcome.rowsModified;
			}
		});

		return results;
	}

	/** Execute one statement, collecting its rows when it returns any. */
	private execPrepared(statementSql: string): SqlExecResult[] {
		const statement = this.handle.prepare(statementSql);
		const columns = statement.columns();

		if (columns.length > 0) {
			const rows = this.allRows(statement, null);
			// sql.js omits a result entry when the query produced no rows.
			if (rows.length === 0) return [];
			return [{ columns: columns.map((column) => column.name), values: rows }];
		}

		const outcome = this.runPrepared(statement, null, true);
		if (outcome.rowsModified > 0) {
			this.lastRowsModified = outcome.rowsModified;
		}
		return [];
	}

	private allRows(statement: SqliteStatement, bind: SqlBindParams | null): SqlValue[][] {
		statement.setReturnArrays(true);
		if (bind === null) {
			return statement.all() as unknown as SqlValue[][];
		}
		if (Array.isArray(bind)) {
			return statement.all(...toInputValues(bind)) as unknown as SqlValue[][];
		}
		return statement.all(
			toNamedParams(bind as Readonly<Record<string, SqlValue>>),
		) as unknown as SqlValue[][];
	}

	private runPrepared(
		statement: SqliteStatement,
		bind: SqlBindParams | null,
		trackChanges: boolean,
	): { rowsModified: number } {
		const outcome = this.runStatement(statement, bind) as StatementRunResult;
		const rowsModified = Number(outcome.changes);
		if (trackChanges) this.lastRowsModified = rowsModified;
		return { rowsModified };
	}

	private runStatement(
		statement: SqliteStatement,
		bind: SqlBindParams | null,
	): unknown {
		if (bind === null) return statement.run();
		if (Array.isArray(bind)) return statement.run(...toInputValues(bind));
		return statement.run(
			toNamedParams(bind as Readonly<Record<string, SqlValue>>),
		);
	}
}
