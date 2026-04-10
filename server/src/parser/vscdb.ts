/**
 * Shared sql.js utility for reading VS Code state.vscdb files.
 * Used by Cursor and Trae adapters.
 */

import { readFileSync } from "node:fs";
import initSqlJs, { type Database } from "sql.js";

let sqlJsInstance: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function getSqlJs() {
	if (!sqlJsInstance) {
		sqlJsInstance = await initSqlJs();
	}
	return sqlJsInstance;
}

/**
 * Open a vscdb file safely via sql.js (in-memory copy, read-only).
 * Retries once after 500ms if the file is locked.
 */
export async function openVscdb(dbPath: string): Promise<Database | null> {
	try {
		const SQL = await getSqlJs();
		const buf = readFileSync(dbPath);
		return new SQL.Database(buf);
	} catch {
		// File locked or corrupted — retry once after short delay
		try {
			await new Promise((r) => setTimeout(r, 500));
			const SQL = await getSqlJs();
			const buf = readFileSync(dbPath);
			return new SQL.Database(buf);
		} catch {
			return null;
		}
	}
}
