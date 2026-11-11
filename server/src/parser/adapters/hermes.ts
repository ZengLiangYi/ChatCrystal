/**
 * Hermes adapter.
 *
 * Hermes keeps its sessions in one SQLite store per home
 * (`<hermesDataDir>/state.db`) and, in current builds, one live store per named
 * profile (`<hermesDataDir>/profiles/<name>/state.db`). The tables used here:
 *
 *  - `sessions`: id, title, cwd, started_at / ended_at / last_activity_at
 *    (unix seconds), plus token counters that are not part of the transcript;
 *  - `messages`: id, session_id, role ("user" | "assistant" | "tool"), content
 *    (plain text, or a `\u0000json:` prefixed JSON array of content blocks),
 *    tool_calls (JSON array, assistant turns), timestamp (unix seconds) and,
 *    in newer schemas, display_metadata / active / compacted bookkeeping
 *    columns that decide what was actually shown in the conversation.
 *
 * Column names drifted across Hermes releases, so every query is built from
 * `PRAGMA table_info` probes and absent columns degrade to harmless defaults.
 * A store is only read when it has a `sessions.id` column (magpie's rule).
 *
 * Hermes can also run inside a WSL distro (`~/.hermes`), so every root returned
 * by `withWslRoots` is scanned (including that root's profiles); `meta.rootDir`
 * records the root of a WSL session.
 */

import { type Dirent, existsSync, readdirSync } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Database } from "sql.js";
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

const SOURCE_NAME = "hermes";
const DISPLAY_NAME = "Hermes";
const PARSER_VERSION = "hermes@1";

const DB_FILE = "state.db";
const PROFILES_DIR = "profiles";
const WSL_RELATIVE_DIR = ".hermes";

/** Prefix Hermes puts on a JSON content payload that is not plain text. */
const JSON_CONTENT_PREFIX = "\u0000json:";

// =============================================
// Data roots and stores
// =============================================

interface HermesStore {
	/** Hermes home the store was found under (a WSL root when applicable). */
	root: string;
	/** The SQLite file, primary or profile. */
	dbPath: string;
}

/** Data roots to scan: the local install plus every WSL distro home. */
function dataRoots(): string[] {
	return withWslRoots(appConfig.hermesDataDir, WSL_RELATIVE_DIR);
}

/** The primary store plus every named profile store below one Hermes home. */
function storesIn(root: string): HermesStore[] {
	const stores: HermesStore[] = [];
	const primary = resolve(root, DB_FILE);
	if (existsSync(primary)) stores.push({ root, dbPath: primary });

	const profilesDir = resolve(root, PROFILES_DIR);
	if (!existsSync(profilesDir)) return stores;

	let entries: Dirent[];
	try {
		entries = readdirSync(profilesDir, { withFileTypes: true });
	} catch {
		return stores;
	}
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		const dbPath = resolve(profilesDir, entry.name, DB_FILE);
		if (existsSync(dbPath)) stores.push({ root, dbPath });
	}
	return stores;
}

async function databaseSignature(dbPath: string): Promise<string | null> {
	let main: Awaited<ReturnType<typeof stat>>;
	try {
		main = await stat(dbPath);
	} catch {
		return null;
	}
	let signature = `${main.size}:${main.mtimeMs}`;
	// Hermes keeps SQLite in WAL mode: fresh rows can live in the sidecar.
	const walPath = `${dbPath}-wal`;
	if (existsSync(walPath)) {
		try {
			const wal = await stat(walPath);
			signature += `|${wal.size}:${wal.mtimeMs}`;
		} catch {
			// The sidecar disappeared between the checks.
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

async function openDatabase(dbPath: string): Promise<Database | null> {
	if (!existsSync(dbPath)) return null;
	const signature = await databaseSignature(dbPath);
	if (signature === null) return null;
	const cached = dbCache.get(dbPath);
	if (cached && cached.signature === signature) return cached.db;
	closeCachedDb(dbPath);
	const db = await openVscdb(dbPath);
	if (!db) return null;
	dbCache.set(dbPath, { signature, db });
	return db;
}

// =============================================
// Schema probing and value helpers
// =============================================

type SqlValue = number | string | Uint8Array | null;

function columnsOf(db: Database, table: string): Set<string> {
	try {
		const result = db.exec(`PRAGMA table_info("${table}")`);
		const rows = result[0]?.values ?? [];
		return new Set(rows.map((row) => String(row[1] ?? "")));
	} catch {
		return new Set();
	}
}

/** A probed column name, or a literal fallback for old schemas. */
function columnOr(columns: Set<string>, name: string, fallback: string): string {
	return columns.has(name) ? name : fallback;
}

function numberOf(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return 0;
}

/** Hermes timestamps are unix seconds (REAL, with a fraction). */
function secondsToIso(seconds: number, fallback: string): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
	const date = new Date(seconds * 1000);
	if (Number.isNaN(date.getTime())) return fallback;
	try {
		return date.toISOString();
	} catch {
		return fallback;
	}
}

function normalizeIsoOrFallback(value: string): string {
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? new Date(0).toISOString() : value;
}

function stringOrNull(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function projectNameFromPath(path: string): string {
	const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? "";
}

function parseJson(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	if (!trimmed) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		return null;
	}
}

function joinTextParts(parts: unknown): string | null {
	const texts: string[] = [];
	const visit = (part: unknown): void => {
		if (typeof part === "string") {
			if (part.trim()) texts.push(part);
			return;
		}
		if (!part || typeof part !== "object") return;
		const record = part as Record<string, unknown>;
		const type = typeof record.type === "string" ? record.type : "";
		// Tool results and images are not conversation text.
		if (type && type !== "text" && type !== "input_text" && type !== "output_text") {
			return;
		}
		if (typeof record.text === "string" && record.text.trim()) {
			texts.push(record.text);
		}
	};

	if (Array.isArray(parts)) {
		for (const part of parts) visit(part);
	} else {
		visit(parts);
	}
	return texts.length > 0 ? texts.join("\n") : null;
}

/**
 * Read a Hermes message body. User rows are `\u0000json:` prefixed block
 * arrays; assistant rows are either the same shape or a bare JSON array, and
 * very old rows hold plain text.
 */
function hermesContentText(raw: unknown): string {
	if (typeof raw !== "string") return "";
	const prefixed = raw.startsWith(JSON_CONTENT_PREFIX);
	const payload = prefixed ? raw.slice(JSON_CONTENT_PREFIX.length) : raw;
	if (!payload.trim()) return "";
	const parsed = parseJson(payload);
	const joined = joinTextParts(parsed);
	if (joined !== null) return joined;
	return prefixed ? "" : raw.trim();
}

/** `tool_calls` is a JSON array of `{ function: { name } }` records. */
function hasToolCalls(raw: unknown): boolean {
	const parsed = parseJson(raw);
	return Array.isArray(parsed) && parsed.length > 0;
}

function isModelOnly(displayMetadata: unknown): boolean {
	const parsed = parseJson(displayMetadata);
	if (!parsed || typeof parsed !== "object") return false;
	return (parsed as Record<string, unknown>).model_only === true;
}

// =============================================
// Session rows
// =============================================

interface HermesSession {
	id: string;
	title: string;
	cwd: string;
	startedAt: number;
	endedAt: number;
	lastActivityAt: number;
}

function listSessions(
	db: Database,
	columns: Set<string>,
): HermesSession[] {
	if (!columns.has("id")) return [];
	const sql = [
		"SELECT id AS id,",
		`COALESCE(${columnOr(columns, "title", "NULL")}, '') AS title,`,
		`COALESCE(${columnOr(columns, "cwd", "NULL")}, '') AS cwd,`,
		`COALESCE(${columnOr(columns, "started_at", "0")}, 0) AS started_at,`,
		`COALESCE(${columnOr(columns, "ended_at", "0")}, 0) AS ended_at,`,
		`COALESCE(${columnOr(columns, "last_activity_at", "0")}, 0) AS last_activity_at`,
		"FROM sessions",
	].join(" ");

	let values: SqlValue[][] = [];
	try {
		values = db.exec(sql)[0]?.values ?? [];
	} catch {
		return [];
	}

	// An id stored once as TEXT and once as BLOB is one session, as late as
	// the later of its rows.
	const merged = new Map<string, HermesSession>();
	for (const row of values) {
		const id = String(row[0] ?? "");
		if (!id) continue;
		const session: HermesSession = {
			id,
			title: String(row[1] ?? ""),
			cwd: String(row[2] ?? ""),
			startedAt: numberOf(row[3]),
			endedAt: numberOf(row[4]),
			lastActivityAt: numberOf(row[5]),
		};
		const existing = merged.get(id);
		if (!existing) {
			merged.set(id, session);
			continue;
		}
		existing.startedAt = Math.min(existing.startedAt, session.startedAt);
		existing.endedAt = Math.max(existing.endedAt, session.endedAt);
		existing.lastActivityAt = Math.max(
			existing.lastActivityAt,
			session.lastActivityAt,
		);
		if (!existing.title) existing.title = session.title;
		if (!existing.cwd) existing.cwd = session.cwd;
	}
	return [...merged.values()];
}

/** Latest message timestamp (unix seconds) per session in one store. */
function lastMessageTimes(
	db: Database,
	messageColumns: Set<string>,
): Map<string, number> {
	const times = new Map<string, number>();
	if (!messageColumns.has("session_id") || !messageColumns.has("timestamp")) {
		return times;
	}
	let values: SqlValue[][] = [];
	try {
		values =
			db.exec(
				"SELECT session_id AS sid, MAX(timestamp) AS last FROM messages GROUP BY session_id",
			)[0]?.values ?? [];
	} catch {
		return times;
	}
	for (const row of values) {
		const sessionId = String(row[0] ?? "");
		const last = numberOf(row[1]);
		if (sessionId && last > 0) times.set(sessionId, last);
	}
	return times;
}

function sessionMtimeIso(
	session: HermesSession,
	messageLast: number | undefined,
	fallback: string,
): string {
	const latest = Math.max(
		session.startedAt,
		session.endedAt,
		session.lastActivityAt,
		messageLast ?? 0,
	);
	return secondsToIso(latest, fallback);
}

// =============================================
// Message rows
// =============================================

function buildMessagesSql(messageColumns: Set<string>): string {
	const role = columnOr(messageColumns, "role", "''");
	const content = columnOr(messageColumns, "content", "''");
	const toolCalls = columnOr(messageColumns, "tool_calls", "NULL");
	const displayMetadata = columnOr(messageColumns, "display_metadata", "NULL");
	const timestamp = columnOr(messageColumns, "timestamp", "0");
	const active = columnOr(messageColumns, "active", "1");
	const compacted = columnOr(messageColumns, "compacted", "0");
	const rowId = columnOr(messageColumns, "id", "rowid");

	let where = "WHERE session_id = ?";
	if (messageColumns.has("active")) {
		// Hidden generations are left out; a compacted live row is kept.
		where += messageColumns.has("compacted")
			? " AND (COALESCE(active, 1) != 0 OR COALESCE(compacted, 0) != 0)"
			: " AND COALESCE(active, 1) != 0";
	}

	return [
		`SELECT ${role} AS role,`,
		`${content} AS content,`,
		`${toolCalls} AS tool_calls,`,
		`${displayMetadata} AS display_metadata,`,
		`${timestamp} AS at,`,
		`${active} AS active,`,
		`${compacted} AS compacted,`,
		`${rowId} AS msg_id`,
		"FROM messages",
		where,
		`ORDER BY ${rowId}`,
	].join(" ");
}

function readMessages(
	db: Database,
	messageColumns: Set<string>,
	sessionId: string,
	fallbackTimestamp: string,
): ParsedMessage[] {
	if (!messageColumns.has("session_id") || !messageColumns.has("role")) {
		return [];
	}

	let values: SqlValue[][] = [];
	try {
		values = db.exec(buildMessagesSql(messageColumns), [sessionId])[0]?.values ?? [];
	} catch {
		return [];
	}

	const messages: ParsedMessage[] = [];
	let index = 0;
	for (const row of values) {
		const role = String(row[0] ?? "").trim().toLowerCase();
		const displayMetadata = row[3];
		const rowId = row[7];
		index++;

		if (isModelOnly(displayMetadata)) continue;
		if (role !== "user" && role !== "assistant") continue;

		const content = hermesContentText(row[1]);
		const toolUse = role === "assistant" && hasToolCalls(row[2]);
		if (!content && !toolUse) continue;

		const id =
			rowId === null || rowId === undefined || String(rowId) === ""
				? `${sessionId}-${index}`
				: String(rowId);
		const timestamp = secondsToIso(numberOf(row[4]), fallbackTimestamp);
		messages.push({
			id,
			parentUuid: null,
			type: role,
			role,
			content,
			hasToolUse: toolUse,
			hasCode: content.includes("```"),
			thinking: null,
			timestamp,
		});
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
		projectName: projectNameFromPath(meta.projectDir),
		cwd: meta.projectDir || null,
		gitBranch: null,
		messages: [],
		firstMessageAt: fallbackTimestamp,
		lastMessageAt: fallbackTimestamp,
	};
}

function assembleConversation(
	meta: ConversationMeta,
	session: HermesSession,
	messages: ParsedMessage[],
): ParsedConversation {
	const fallbackTimestamp = normalizeIsoOrFallback(meta.fileMtime);
	const projectDir = session.cwd.trim();
	const firstFromSession = secondsToIso(session.startedAt, fallbackTimestamp);
	const lastFromSession = secondsToIso(
		Math.max(session.startedAt, session.endedAt, session.lastActivityAt),
		fallbackTimestamp,
	);
	return {
		id: meta.id,
		slug: stringOrNull(session.title),
		source: SOURCE_NAME,
		projectDir,
		projectName: projectNameFromPath(projectDir),
		cwd: projectDir || null,
		gitBranch: null,
		messages,
		firstMessageAt: messages[0]?.timestamp ?? firstFromSession,
		lastMessageAt: messages[messages.length - 1]?.timestamp ?? lastFromSession,
	};
}

// =============================================
// Per-root discovery
// =============================================

async function scanStore(store: HermesStore): Promise<ConversationMeta[]> {
	const db = await openDatabase(store.dbPath);
	if (!db) return [];

	const sessionColumns = columnsOf(db, "sessions");
	if (!sessionColumns.has("id")) return [];
	const messageColumns = columnsOf(db, "messages");
	const sessions = listSessions(db, sessionColumns);
	if (sessions.length === 0) return [];

	const lastTimes = lastMessageTimes(db, messageColumns);
	let fallbackMtime = new Date(0).toISOString();
	try {
		fallbackMtime = (await stat(store.dbPath)).mtime.toISOString();
	} catch {
		// The store disappeared mid-scan; the session timestamps still order it.
	}

	return sessions.map((session) => ({
		id: session.id,
		source: SOURCE_NAME,
		filePath: store.dbPath,
		// A store is shared by every session, so its file size cannot say which
		// session changed: the per-session latest activity is the change signal.
		fileSize: 0,
		fileMtime: sessionMtimeIso(session, lastTimes.get(session.id), fallbackMtime),
		projectDir: session.cwd,
		rootDir: store.root,
	}));
}

async function scanRoot(root: string): Promise<ConversationMeta[]> {
	const metas: ConversationMeta[] = [];
	for (const store of storesIn(root)) {
		metas.push(...(await scanStore(store)));
	}
	return metas;
}

/** Scan every root, keeping the first store's row when ids collide. */
async function scanSessions(): Promise<ConversationMeta[]> {
	const metas: ConversationMeta[] = [];
	const seenIds = new Set<string>();
	for (const root of dataRoots()) {
		try {
			for (const meta of await scanRoot(root)) {
				if (seenIds.has(meta.id)) continue;
				seenIds.add(meta.id);
				metas.push(meta);
			}
		} catch {
			// A stopped distro must not abort the local scan.
		}
	}
	return metas;
}

// =============================================
// Hermes Adapter
// =============================================

export const hermesAdapter: SourceAdapter = {
	name: SOURCE_NAME,
	displayName: DISPLAY_NAME,
	parserVersion: PARSER_VERSION,

	async detect(): Promise<SourceInfo | null> {
		try {
			const metas = await scanSessions();
			if (metas.length === 0) return null;

			return {
				name: SOURCE_NAME,
				displayName: DISPLAY_NAME,
				dataDir: appConfig.hermesDataDir,
				conversationCount: metas.length,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		return await scanSessions();
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		const db = await openDatabase(meta.filePath);
		if (!db) return emptyConversation(meta);

		const sessionColumns = columnsOf(db, "sessions");
		if (!sessionColumns.has("id")) return emptyConversation(meta);

		let session: HermesSession | undefined;
		try {
			session = listSessions(db, sessionColumns).find(
				(candidate) => candidate.id === meta.id,
			);
		} catch {
			session = undefined;
		}
		if (!session) return emptyConversation(meta);

		const messageColumns = columnsOf(db, "messages");
		const fallbackTimestamp = normalizeIsoOrFallback(meta.fileMtime);
		const messages = readMessages(
			db,
			messageColumns,
			meta.id,
			fallbackTimestamp,
		);
		return assembleConversation(meta, session, messages);
	},

	watchPaths(): string[] {
		// Watch the local install only: watching `\\wsl.localhost` UNC paths is
		// slow and would start stopped distros. WSL sessions are picked up on the
		// next manual Import.
		const paths: string[] = [];
		for (const store of storesIn(appConfig.hermesDataDir)) {
			paths.push(store.dbPath);
			const walPath = `${store.dbPath}-wal`;
			if (existsSync(walPath)) paths.push(walPath);
		}
		return paths;
	},
};
