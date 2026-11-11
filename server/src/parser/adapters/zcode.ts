/**
 * ZCode adapter.
 *
 * ZCode is a desktop application built on OpenCode's CLI: its sessions live in
 * one SQLite database at `<zcodeDataDir>/cli/db/db.sqlite` using OpenCode's
 * tables. Two generations coexist exactly like OpenCode's:
 *
 *  - 1.x: `session`, `message` and `part` tables. `message.data` is a JSON
 *    document `{ role, time: { created }, semantics? }` and each `part.data` is
 *    one block `{ type: "text" | "reasoning" | "tool", text?, time? }`.
 *  - 2.x: `session_v2` and `session_message` tables (a turn per row, role in
 *    `type` and its payload in the JSON `data` column).
 *
 * ZCode adds a `title_source` column: a session whose title is still the
 * default one (`title_source = "default"`) has no usable title, so it is
 * exported without a slug. A user message carries `semantics.origin`: only a
 * prompt the person actually typed has `real_user`, the rest are harness
 * reminders injected into the transcript and are dropped here.
 *
 * ZCode also runs inside WSL distros (`~/.zcode`), so every root returned by
 * `withWslRoots` is scanned; `meta.rootDir` carries the root of a WSL session.
 */

import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Database, Statement } from "sql.js";
import type {
	ConversationMeta,
	ParsedConversation,
	ParsedMessage,
	SourceInfo,
} from "@chatcrystal/shared";
import { appConfig } from "../../config.js";
import type { SourceAdapter } from "../adapter.js";
import { withWslRoots } from "../sourceRoots.js";
import { openVscdb } from "../vscdb.js";

const SOURCE_NAME = "zcode";
const DISPLAY_NAME = "ZCode";
const PARSER_VERSION = "zcode@1";

const DB_RELATIVE_PATH = ["cli", "db", "db.sqlite"];
const WSL_RELATIVE_DIR = ".zcode";

// =============================================
// Raw shapes
// =============================================

interface SessionInfo {
	id: string;
	parentId: string;
	directory: string;
	title: string;
	titleSource: string;
	timeCreated: number;
	timeUpdated: number;
}

interface LocatedSession {
	info: SessionInfo;
	store: "v2" | "v1";
}

interface ExtractedContent {
	text: string;
	thinking: string | null;
	hasToolUse: boolean;
}

// sql.js returns dynamic rows; keep the value shape local.
type SqlValue = number | string | Uint8Array | null;
type SqlRow = Record<string, SqlValue>;

// =============================================
// Data roots and database file
// =============================================

/** Data roots to scan: the local install plus every WSL distro home. */
function dataRoots(): string[] {
	return withWslRoots(appConfig.zcodeDataDir, WSL_RELATIVE_DIR);
}

function getDatabasePath(root: string = appConfig.zcodeDataDir): string {
	return resolve(root, ...DB_RELATIVE_PATH);
}

async function databaseFileMeta(
	dbPath: string,
): Promise<{ fileSize: number; fileMtime: string }> {
	try {
		const dbStat = await stat(dbPath);
		let size = dbStat.size;
		let mtimeMs = dbStat.mtimeMs;
		// SQLite keeps fresh commits in a WAL sidecar until a checkpoint.
		const walPath = `${dbPath}-wal`;
		if (existsSync(walPath)) {
			try {
				const walStat = await stat(walPath);
				size += walStat.size;
				mtimeMs = Math.max(mtimeMs, walStat.mtimeMs);
			} catch {
				// The sidecar disappeared between the checks.
			}
		}
		return { fileSize: size, fileMtime: new Date(mtimeMs).toISOString() };
	} catch {
		return { fileSize: 0, fileMtime: new Date(0).toISOString() };
	}
}

async function databaseSignature(dbPath: string): Promise<string> {
	const dbStat = await stat(dbPath);
	let signature = `${dbStat.size}:${dbStat.mtimeMs}`;
	const walPath = `${dbPath}-wal`;
	if (existsSync(walPath)) {
		try {
			const walStat = await stat(walPath);
			signature += `|${walStat.size}:${walStat.mtimeMs}`;
		} catch {
			// The sidecar disappeared; the main file signature is enough.
		}
	}
	return signature;
}

// =============================================
// Cached sql.js handles, keyed by database path
// =============================================

const dbCache = new Map<string, { signature: string; db: Database }>();

function closeCachedDb(dbPath: string): void {
	const cached = dbCache.get(dbPath);
	if (!cached) return;
	try {
		cached.db.close();
	} catch {
		// Already closed.
	}
	dbCache.delete(dbPath);
}

/** Open one database, reusing the sql.js copy while the file is unchanged. */
async function openDatabase(dbPath: string): Promise<Database | null> {
	if (!existsSync(dbPath)) return null;
	let signature: string;
	try {
		signature = await databaseSignature(dbPath);
	} catch {
		return null;
	}
	const cached = dbCache.get(dbPath);
	if (cached && cached.signature === signature) return cached.db;
	closeCachedDb(dbPath);
	const db = await openVscdb(dbPath);
	if (!db) return null;
	dbCache.set(dbPath, { signature, db });
	return db;
}

// =============================================
// Value helpers
// =============================================

function numberOf(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return 0;
}

/** Normalize RFC 3339 strings and numeric seconds/milliseconds to millis. */
function readMillis(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return value < 1e11 ? value * 1000 : value;
	}
	if (typeof value === "string" && value.trim()) {
		const trimmed = value.trim();
		const numeric = Number(trimmed);
		if (Number.isFinite(numeric) && numeric > 0) {
			return numeric < 1e11 ? numeric * 1000 : numeric;
		}
		const parsed = Date.parse(trimmed);
		if (!Number.isNaN(parsed)) return parsed;
	}
	return null;
}

/** Read a `{ created, completed, start }` time object. */
function readTimeObject(value: unknown): number | null {
	if (!value || typeof value !== "object") return null;
	const time = value as Record<string, unknown>;
	return (
		readMillis(time.created) ?? readMillis(time.completed) ?? readMillis(time.start)
	);
}

function isoOr(millis: number | null, fallback: string): string {
	if (millis === null) return fallback;
	const date = new Date(millis);
	return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeIsoOrFallback(value: string): string {
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? new Date(0).toISOString() : value;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
	let text = "";
	if (typeof value === "string") text = value;
	else if (value instanceof Uint8Array) text = new TextDecoder().decode(value);
	if (!text.trim()) return null;
	try {
		const parsed: unknown = JSON.parse(text);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return null;
		}
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

function projectNameFromDirectory(directory: string, fallback: string): string {
	if (!directory) return fallback;
	const normalized = directory.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? fallback;
}

/** A default OpenCode/ZCode title is a placeholder, not a name. */
function sessionSlug(title: string): string | null {
	const trimmed = title.trim();
	if (!trimmed) return null;
	if (/^(?:New|Child) session - /.test(trimmed)) return null;
	if (trimmed === "New session" || trimmed === "New Chat") return null;
	return trimmed;
}

// =============================================
// sql.js helpers
// =============================================

function queryRows(db: Database, sql: string, params: SqlValue[] = []): SqlRow[] {
	let statement: Statement | null = null;
	try {
		statement = db.prepare(sql);
		if (params.length > 0) statement.bind(params);
		const rows: SqlRow[] = [];
		while (statement.step()) {
			rows.push(statement.getAsObject() as SqlRow);
		}
		return rows;
	} catch {
		return [];
	} finally {
		statement?.free();
	}
}

function columnsOf(db: Database, table: string): Set<string> {
	const rows = queryRows(db, `PRAGMA table_info('${table}')`);
	return new Set(rows.map((row) => String(row.name ?? "")));
}

// =============================================
// Session rows
// =============================================

function sessionSelectSql(db: Database, table: string): string | null {
	const columns = columnsOf(db, table);
	if (!columns.has("id")) return null;
	const column = (name: string, fallback: string): string =>
		columns.has(name) ? name : fallback;
	return [
		"SELECT id AS id,",
		`COALESCE(${column("parent_id", "NULL")}, '') AS parent_id,`,
		`COALESCE(${column("directory", "''")}, '') AS directory,`,
		`COALESCE(${column("title", "NULL")}, '') AS title,`,
		`COALESCE(${column("title_source", "NULL")}, '') AS title_source,`,
		`${column("time_created", "0")} AS time_created,`,
		`${column("time_updated", "0")} AS time_updated`,
		`FROM ${table}`,
	].join(" ");
}

function toSessionInfo(row: SqlRow): SessionInfo {
	return {
		id: String(row.id ?? ""),
		parentId: String(row.parent_id ?? ""),
		directory: String(row.directory ?? ""),
		title: String(row.title ?? ""),
		titleSource: String(row.title_source ?? ""),
		timeCreated: numberOf(row.time_created),
		timeUpdated: numberOf(row.time_updated),
	};
}

/** All sessions in the database; the session_v2 copy of a session wins. */
function listSessions(db: Database): SessionInfo[] {
	const merged = new Map<string, SessionInfo>();

	const v2Sql = sessionSelectSql(db, "session_v2");
	if (v2Sql) {
		for (const row of queryRows(db, v2Sql)) {
			const session = toSessionInfo(row);
			if (session.id) merged.set(session.id, session);
		}
	}

	const v1Sql = sessionSelectSql(db, "session");
	if (v1Sql) {
		for (const row of queryRows(db, v1Sql)) {
			const session = toSessionInfo(row);
			if (session.id && !merged.has(session.id)) {
				merged.set(session.id, session);
			}
		}
	}

	return [...merged.values()];
}

function readSession(db: Database, sessionId: string): LocatedSession | null {
	const v2Sql = sessionSelectSql(db, "session_v2");
	if (v2Sql) {
		const rows = queryRows(db, `${v2Sql} WHERE id = ?`, [sessionId]);
		if (rows[0]) return { info: toSessionInfo(rows[0]), store: "v2" };
	}
	const v1Sql = sessionSelectSql(db, "session");
	if (v1Sql) {
		const rows = queryRows(db, `${v1Sql} WHERE id = ?`, [sessionId]);
		if (rows[0]) return { info: toSessionInfo(rows[0]), store: "v1" };
	}
	return null;
}

// =============================================
// Message content extraction
// =============================================

/**
 * Extract text, reasoning and the tool-use flag from OpenCode-style content
 * blocks. Noise blocks (step-start / step-finish / snapshot / patch / ...)
 * carry no conversation text and are skipped; tool payloads stay out of the
 * body and only set the flag.
 */
function extractBlocks(blocks: unknown): ExtractedContent {
	const texts: string[] = [];
	const thoughts: string[] = [];
	let hasToolUse = false;

	const visit = (block: unknown): void => {
		if (!block || typeof block !== "object") return;
		const record = block as Record<string, unknown>;
		const type = typeof record.type === "string" ? record.type : "";
		if (type === "text") {
			if (typeof record.text === "string" && record.text.trim()) {
				texts.push(record.text);
			}
			return;
		}
		if (type === "reasoning") {
			if (typeof record.text === "string" && record.text.trim()) {
				thoughts.push(record.text);
			}
			return;
		}
		if (
			type === "tool" ||
			type === "tool-invocation" ||
			type === "tool_use"
		) {
			hasToolUse = true;
		}
	};

	if (typeof blocks === "string") {
		if (blocks.trim()) texts.push(blocks);
	} else if (Array.isArray(blocks)) {
		for (const block of blocks) visit(block);
	}

	return {
		text: texts.join("\n").trim(),
		thinking: thoughts.length > 0 ? thoughts.join("\n") : null,
		hasToolUse,
	};
}

/** Extract from 1.x `part` documents, which may be ignored by the app itself. */
function extractPartDocuments(
	documents: Record<string, unknown>[],
): ExtractedContent {
	const visible = documents.filter((document) => document.ignored !== true);
	return extractBlocks(visible);
}

function buildParsedMessage(
	id: string,
	type: "user" | "assistant",
	extracted: ExtractedContent,
	timestamp: string,
): ParsedMessage {
	return {
		id,
		parentUuid: null,
		type,
		role: type,
		content: extracted.text,
		hasToolUse: extracted.hasToolUse,
		hasCode: extracted.text.includes("```"),
		thinking: extracted.thinking,
		timestamp,
	};
}

// =============================================
// 2.x store: session_message
// =============================================

function readV2Messages(
	db: Database,
	sessionId: string,
	fallbackTimestamp: string,
): ParsedMessage[] {
	const columns = columnsOf(db, "session_message");
	if (!columns.has("id") || !columns.has("data")) return [];

	const orderBy = columns.has("seq")
		? "seq"
		: columns.has("time_created")
			? "time_created, id"
			: "id";
	const select = [
		"SELECT id AS id, type AS type, data AS data",
		columns.has("time_created") ? ", time_created AS time_created" : "",
		"FROM session_message WHERE session_id = ?",
		`ORDER BY ${orderBy}`,
	].join(" ");
	const rows = queryRows(db, select, [sessionId]);

	const messages: ParsedMessage[] = [];
	let index = 0;
	for (const row of rows) {
		const messageId = String(row.id ?? "");
		const type = String(row.type ?? "");
		const data = parseJsonObject(row.data);
		if (!data) {
			index++;
			continue;
		}

		const timestampMs =
			readTimeObject(data.time) ?? (numberOf(row.time_created) || null);
		const timestamp = isoOr(timestampMs, fallbackTimestamp);
		const fallbackId = `${sessionId}-${index}`;

		if (type === "user") {
			const text = typeof data.text === "string" ? data.text.trim() : "";
			if (text) {
				messages.push(
					buildParsedMessage(
						messageId || fallbackId,
						"user",
						{ text, thinking: null, hasToolUse: false },
						timestamp,
					),
				);
			}
		} else if (type === "assistant") {
			const extracted = extractBlocks(data.content);
			if (extracted.text || extracted.thinking || extracted.hasToolUse) {
				messages.push(
					buildParsedMessage(
						messageId || fallbackId,
						"assistant",
						extracted,
						timestamp,
					),
				);
			}
		}
		index++;
	}
	return messages;
}

// =============================================
// 1.x store: message + part
// =============================================

function readV1PartDocuments(
	db: Database,
	messageId: string,
): Record<string, unknown>[] {
	const columns = columnsOf(db, "part");
	if (!columns.has("data") || !columns.has("message_id")) return [];
	const orderBy = columns.has("id")
		? "id"
		: columns.has("time_created")
			? "time_created"
			: "rowid";
	const rows = queryRows(
		db,
		`SELECT data AS data FROM part WHERE message_id = ? ORDER BY ${orderBy}`,
		[messageId],
	);
	return rows
		.map((row) => parseJsonObject(row.data))
		.filter((document): document is Record<string, unknown> => document !== null);
}

function readV1Messages(
	db: Database,
	sessionId: string,
	fallbackTimestamp: string,
): ParsedMessage[] {
	const columns = columnsOf(db, "message");
	if (!columns.has("id") || !columns.has("data") || !columns.has("session_id")) {
		return [];
	}
	const orderBy = columns.has("time_created") ? "time_created, id" : "id";
	const rows = queryRows(
		db,
		`SELECT * FROM message WHERE session_id = ? ORDER BY ${orderBy}`,
		[sessionId],
	);

	const messages: ParsedMessage[] = [];
	let index = 0;
	for (const row of rows) {
		const data = parseJsonObject(row.data);
		if (!data) {
			index++;
			continue;
		}
		const role = typeof data.role === "string" ? data.role : "";
		const type =
			role === "user" ? "user" : role === "assistant" ? "assistant" : null;
		if (!type) {
			index++;
			continue;
		}

		// ZCode records where a user message came from: only `real_user` was
		// typed by the person, everything else is injected harness context.
		if (type === "user" && data.semantics && typeof data.semantics === "object") {
			const semantics = data.semantics as Record<string, unknown>;
			const origin =
				typeof semantics.origin === "string" ? semantics.origin : "";
			if (origin && origin !== "real_user") {
				index++;
				continue;
			}
		}

		const messageId = String(row.id ?? "");
		const documents = readV1PartDocuments(db, messageId);
		const extracted = extractPartDocuments(documents);
		if (!extracted.text && !extracted.thinking && !extracted.hasToolUse) {
			index++;
			continue;
		}

		const timestampMs =
			readTimeObject(data.time) ?? (numberOf(row.time_created) || null);
		messages.push(
			buildParsedMessage(
				messageId || `${sessionId}-${index}`,
				type,
				extracted,
				isoOr(timestampMs, fallbackTimestamp),
			),
		);
		index++;
	}
	return messages;
}

// =============================================
// Conversation assembly
// =============================================

function emptyConversation(meta: ConversationMeta): ParsedConversation {
	const fallbackTimestamp = normalizeIsoOrFallback(meta.fileMtime);
	return {
		id: meta.id,
		slug: null,
		source: SOURCE_NAME,
		projectDir: meta.projectDir,
		projectName: projectNameFromDirectory(meta.projectDir, "ZCode"),
		cwd: meta.projectDir || null,
		gitBranch: null,
		messages: [],
		firstMessageAt: fallbackTimestamp,
		lastMessageAt: fallbackTimestamp,
	};
}

function assembleConversation(
	meta: ConversationMeta,
	info: SessionInfo,
	messages: ParsedMessage[],
	fallbackTimestamp: string,
): ParsedConversation {
	messages.sort(
		(left, right) =>
			new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
	);
	const sessionCreated = info.timeCreated > 0 ? info.timeCreated : null;
	const firstTimestamp =
		messages[0]?.timestamp ??
		isoOr(sessionCreated, fallbackTimestamp);
	const title = info.titleSource === "default" ? "" : info.title;
	return {
		id: meta.id,
		slug: sessionSlug(title),
		source: SOURCE_NAME,
		projectDir: info.directory,
		projectName: projectNameFromDirectory(info.directory, "ZCode"),
		cwd: info.directory || null,
		gitBranch: null,
		messages,
		firstMessageAt: firstTimestamp,
		lastMessageAt: messages[messages.length - 1]?.timestamp ?? firstTimestamp,
	};
}

// =============================================
// Per-root discovery
// =============================================

async function scanRoot(root: string): Promise<ConversationMeta[]> {
	const dbPath = getDatabasePath(root);
	if (!existsSync(dbPath)) return [];
	const db = await openDatabase(dbPath);
	if (!db) return [];

	const sessions = listSessions(db);
	if (sessions.length === 0) return [];
	const fileMeta = await databaseFileMeta(dbPath);

	return sessions.map((session) => ({
		id: session.id,
		source: SOURCE_NAME,
		filePath: dbPath,
		fileSize: fileMeta.fileSize,
		fileMtime: fileMeta.fileMtime,
		projectDir: session.directory,
		rootDir: root,
	}));
}

// =============================================
// ZCode Adapter
// =============================================

export const zcodeAdapter: SourceAdapter = {
	name: SOURCE_NAME,
	displayName: DISPLAY_NAME,
	parserVersion: PARSER_VERSION,

	async detect(): Promise<SourceInfo | null> {
		try {
			let conversationCount = 0;
			for (const root of dataRoots()) {
				try {
					conversationCount += (await scanRoot(root)).length;
				} catch {
					// A WSL distro can stop mid-scan; keep the other roots.
				}
			}
			if (conversationCount === 0) return null;

			return {
				name: SOURCE_NAME,
				displayName: DISPLAY_NAME,
				dataDir: appConfig.zcodeDataDir,
				conversationCount,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		const metas: ConversationMeta[] = [];
		for (const root of dataRoots()) {
			try {
				metas.push(...(await scanRoot(root)));
			} catch {
				// A stopped distro must not abort the local scan.
			}
		}
		return metas;
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		// The meta's own path is the database (no sibling storage here), so a
		// WSL conversation reads from the distro's file without a root lookup.
		const db = await openDatabase(meta.filePath);
		if (!db) return emptyConversation(meta);

		const located = readSession(db, meta.id);
		if (!located) return emptyConversation(meta);

		const fallbackTimestamp = normalizeIsoOrFallback(meta.fileMtime);
		const messages =
			located.store === "v2"
				? readV2Messages(db, meta.id, fallbackTimestamp)
				: readV1Messages(db, meta.id, fallbackTimestamp);
		return assembleConversation(
			meta,
			located.info,
			messages,
			fallbackTimestamp,
		);
	},

	watchPaths(): string[] {
		// Watch the local install only: watching `\\wsl.localhost` UNC paths is
		// slow and would start stopped distros. WSL sessions are picked up on the
		// next manual Import.
		const paths: string[] = [];
		const dbPath = getDatabasePath();
		if (existsSync(dbPath)) paths.push(dbPath);
		const walPath = `${dbPath}-wal`;
		if (existsSync(walPath)) paths.push(walPath);
		return paths;
	},
};
