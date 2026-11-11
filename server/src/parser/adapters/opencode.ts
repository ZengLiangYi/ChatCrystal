/**
 * OpenCode adapter.
 *
 * OpenCode keeps every session in one SQLite database (`opencode.db` under the
 * data directory) and, before that, in per-session JSON files below
 * `storage/`. Two database generations coexist:
 *
 *  - 1.x: `session`, `message` and `part` tables. `message.data` and
 *    `part.data` are JSON documents: `{ role, time: { created } }` and
 *    `{ type: "text" | "reasoning" | "tool", text?, time: { start } }`.
 *  - 2.x: `session_v2` and `session_message` tables. A `session_message` row is
 *    one turn with its role in `type` and the turn itself in the JSON `data`
 *    column: a user prompt is `{ text }`, a reply is `{ content: [...] }` with
 *    text / reasoning / tool blocks, and both carry `time: { created }`.
 *
 * OpenCode 2 copies 1.x sessions into the new tables on first start but leaves
 * the old tables in place, so a session the migration has not reached yet only
 * exists in `session`/`message`/`part`; both stores are read and the
 * `session_v2` copy wins when a session is in both. When there is a database,
 * the legacy JSON files are ignored (they were the source the database was
 * built from); they are read only when the database is absent.
 *
 * Tool payloads (inputs, outputs) are not written into the message body: a turn
 * with a tool block is only flagged as tool-using. Subagent runs have a
 * non-empty `parent_id` and still import as independent conversations.
 *
 * The same layout also lives inside a WSL distro (`~/.local/share/opencode`), so
 * every root returned by `withWslRoots` is scanned; `meta.rootDir` carries the
 * root of a WSL session into `parse()`.
 */

import { existsSync } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
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

const SOURCE_NAME = "opencode";
const DISPLAY_NAME = "OpenCode";
const PARSER_VERSION = "opencode@2";

const DB_FILENAME = "opencode.db";
const STORAGE_DIRNAME = "storage";
/** OpenCode's data dir relative to a WSL distro user home. */
const WSL_RELATIVE_DIR = ".local/share/opencode";

/**
 * Keep the in-memory sql.js copy of each database between the detect → scan →
 * parse calls of one import pass; a file can be large, while parsing every
 * session would otherwise re-read it from scratch. The cache is keyed by the
 * database path, so the local install and a WSL distro never share a handle.
 */
const DB_IDLE_CLOSE_MS = 20_000;

// =============================================
// Raw OpenCode shapes
// =============================================

interface SessionInfo {
	id: string;
	parentId: string;
	directory: string;
	title: string;
	timeCreated: number;
	timeUpdated: number;
}

interface LocatedSession {
	info: SessionInfo;
	store: "v2" | "v1";
}

// sql.js returns dynamic rows; keep the value shape local.
type SqlValue = number | string | Uint8Array | null;
type SqlRow = Record<string, SqlValue>;

interface ExtractedContent {
	text: string;
	thinking: string | null;
	hasToolUse: boolean;
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

/**
 * Normalize the timestamps OpenCode has stored (RFC 3339 strings and numeric
 * Unix seconds or milliseconds) to epoch milliseconds.
 */
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

/** OpenCode names a session "New session - <time>" until it generates a title. */
function sessionSlug(title: string): string | null {
	const trimmed = title.trim();
	if (!trimmed) return null;
	if (/^(?:New|Child) session - /.test(trimmed)) return null;
	return trimmed;
}

function normalizeIsoOrFallback(value: string): string {
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? new Date(0).toISOString() : value;
}

// =============================================
// Data roots, database path and file metadata
// =============================================

/** Data roots to scan: the local install plus every WSL distro home. */
function dataRoots(): string[] {
	return withWslRoots(appConfig.opencodeDataDir, WSL_RELATIVE_DIR);
}

function isPrimaryRoot(root: string): boolean {
	if (root === appConfig.opencodeDataDir) return true;
	if (process.platform !== "win32") return false;
	return (
		resolve(root).toLowerCase() ===
		resolve(appConfig.opencodeDataDir).toLowerCase()
	);
}

function getDatabasePath(root: string = appConfig.opencodeDataDir): string {
	// OpenCode resolves OPENCODE_DB against its local data directory; a WSL
	// install always keeps its database under its own data root.
	const override = process.env.OPENCODE_DB?.trim();
	if (isPrimaryRoot(root) && override && override !== ":memory:") {
		return isAbsolute(override) ? override : resolve(root, override);
	}
	return resolve(root, DB_FILENAME);
}

async function databaseFileMeta(
	dbPath: string,
): Promise<{ fileSize: number; fileMtime: string }> {
	try {
		const dbStat = await stat(dbPath);
		let size = dbStat.size;
		let mtimeMs = dbStat.mtimeMs;
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
// Cached database handles, keyed by database path (one per root)
// =============================================

interface CachedDatabase {
	path: string;
	signature: string;
	db: Database;
	idleTimer: NodeJS.Timeout | null;
}

const cachedDatabases = new Map<string, CachedDatabase>();

async function databaseSignature(dbPath: string): Promise<string> {
	const dbStat = await stat(dbPath);
	let signature = `${dbStat.size}:${dbStat.mtimeMs}`;
	// OpenCode keeps SQLite in WAL mode: fresh commits can live in the sidecar
	// until a checkpoint, so a change there must reopen the copy as well.
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

function closeCachedDatabase(dbPath: string): void {
	const cached = cachedDatabases.get(dbPath);
	if (!cached) return;
	if (cached.idleTimer) clearTimeout(cached.idleTimer);
	try {
		cached.db.close();
	} catch {
		// Already closed.
	}
	cachedDatabases.delete(dbPath);
}

function scheduleIdleClose(entry: CachedDatabase): void {
	if (entry.idleTimer) clearTimeout(entry.idleTimer);
	const timer = setTimeout(() => {
		if (cachedDatabases.get(entry.path) === entry) {
			closeCachedDatabase(entry.path);
		}
	}, DB_IDLE_CLOSE_MS);
	// The cache must not keep the server process alive.
	timer.unref();
	entry.idleTimer = timer;
}

/**
 * Open one root's OpenCode database, reusing the cached sql.js copy while that
 * file is unchanged. One database holds every session of a root, so importing
 * N sessions would otherwise load the whole file N times.
 */
async function openDatabase(dbPath: string): Promise<Database | null> {
	if (!existsSync(dbPath)) return null;
	let signature: string;
	try {
		signature = await databaseSignature(dbPath);
	} catch {
		return null;
	}
	const cached = cachedDatabases.get(dbPath);
	if (cached && cached.signature === signature) {
		scheduleIdleClose(cached);
		return cached.db;
	}
	if (cached) closeCachedDatabase(dbPath);
	const db = await openVscdb(dbPath);
	if (!db) return null;
	const entry: CachedDatabase = {
		path: dbPath,
		signature,
		db,
		idleTimer: null,
	};
	cachedDatabases.set(dbPath, entry);
	scheduleIdleClose(entry);
	return db;
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

	// A database upgraded from 1.x keeps the old tables beside the new ones and
	// copies sessions over lazily; read the old rows for what is not migrated.
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
 * Extract text, reasoning and the tool-use flag from a list of content blocks.
 * Both the 2.x reply `content` array and the 1.x `part` documents use the same
 * block shapes; noise blocks (step-start / step-finish / snapshot / patch / …)
 * carry no conversation text and are skipped.
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
			// Tool input/output stay out of the body; only the flag is kept.
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

/** Extract from 1.x `part` documents, which may be ignored by OpenCode itself. */
function extractPartDocuments(documents: Record<string, unknown>[]): ExtractedContent {
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
		// Compaction / synthetic / idle / shell / skill / model-switched rows are
		// OpenCode's own bookkeeping, not conversation turns.
		if (!data) {
			index++;
			continue;
		}

		const timestampMs =
			readTimeObject(data.time) ?? (numberOf(row.time_created) || null);
		const timestamp = isoOr(timestampMs, fallbackTimestamp);
		const fallbackId = `${sessionId}-${index}`;

		if (type === "user") {
			// A user turn's data is the prompt itself: { text, files?, skills?, … }.
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
	const orderBy = columns.has("time_created")
		? "time_created, id"
		: "id";
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
// Legacy JSON storage
// =============================================

async function readJsonFile(
	filePath: string,
): Promise<Record<string, unknown> | null> {
	try {
		return parseJsonObject(await readFile(filePath, "utf-8"));
	} catch {
		return null;
	}
}

async function readStoragePartDocuments(
	root: string,
	messageId: string,
): Promise<Record<string, unknown>[]> {
	const partsDir = resolve(root, STORAGE_DIRNAME, "part", messageId);
	if (!existsSync(partsDir)) return [];
	let entries: Dirent[];
	try {
		entries = await readdir(partsDir, { withFileTypes: true });
	} catch {
		return [];
	}
	const documents: Record<string, unknown>[] = [];
	for (const entry of entries
		.filter((item) => item.isFile() && item.name.endsWith(".json"))
		.sort((left, right) => left.name.localeCompare(right.name))) {
		const document = await readJsonFile(resolve(partsDir, entry.name));
		if (document) documents.push(document);
	}
	return documents;
}

/** Size and newest mtime of a session's files (one mtime drives import dedup). */
async function storageSessionFileMeta(
	root: string,
	sessionId: string,
	sessionPath: string,
): Promise<{ fileSize: number; fileMtimeMs: number }> {
	let size = 0;
	let mtimeMs = 0;

	const sessionStat = await stat(sessionPath).catch(() => null);
	if (sessionStat) {
		size += sessionStat.size;
		mtimeMs = sessionStat.mtimeMs;
	}

	const messagesDir = resolve(root, STORAGE_DIRNAME, "message", sessionId);
	if (existsSync(messagesDir)) {
		let entries: Dirent[];
		try {
			entries = await readdir(messagesDir, { withFileTypes: true });
		} catch {
			entries = [];
		}
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
			const messageStat = await stat(resolve(messagesDir, entry.name)).catch(
				() => null,
			);
			if (!messageStat) continue;
			size += messageStat.size;
			mtimeMs = Math.max(mtimeMs, messageStat.mtimeMs);
		}
	}

	return { fileSize: size, fileMtimeMs: mtimeMs > 0 ? mtimeMs : Date.now() };
}

async function scanStorage(root: string): Promise<ConversationMeta[]> {
	const sessionRoot = resolve(root, STORAGE_DIRNAME, "session");
	if (!existsSync(sessionRoot)) return [];

	let projectEntries: Dirent[];
	try {
		projectEntries = await readdir(sessionRoot, { withFileTypes: true });
	} catch {
		return [];
	}

	const metas: ConversationMeta[] = [];
	for (const projectEntry of projectEntries) {
		if (!projectEntry.isDirectory()) continue;
		const projectDir = resolve(sessionRoot, projectEntry.name);

		let fileEntries: Dirent[];
		try {
			fileEntries = await readdir(projectDir, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const fileEntry of fileEntries) {
			if (!fileEntry.isFile() || !fileEntry.name.endsWith(".json")) continue;
			const filePath = resolve(projectDir, fileEntry.name);
			const info = await readJsonFile(filePath);
			if (!info) continue;
			const id =
				typeof info.id === "string" && info.id
					? info.id
					: basename(fileEntry.name, ".json");
			if (!id) continue;
			const { fileSize, fileMtimeMs } = await storageSessionFileMeta(
				root,
				id,
				filePath,
			);
			metas.push({
				id,
				source: SOURCE_NAME,
				filePath,
				fileSize,
				fileMtime: new Date(fileMtimeMs).toISOString(),
				projectDir:
					typeof info.directory === "string" ? info.directory : "",
				rootDir: root,
			});
		}
	}

	return metas;
}

async function parseStorageConversation(
	meta: ConversationMeta,
): Promise<ParsedConversation> {
	const root = meta.rootDir ?? appConfig.opencodeDataDir;
	const fallbackTimestamp = normalizeIsoOrFallback(meta.fileMtime);
	const info = await readJsonFile(meta.filePath);
	const sessionId =
		typeof info?.id === "string" && info.id ? info.id : meta.id;
	const directory =
		typeof info?.directory === "string" ? info.directory : meta.projectDir;
	const title = typeof info?.title === "string" ? info.title : "";
	const sessionCreated = readTimeObject(info?.time);

	const messages: ParsedMessage[] = [];
	const messagesDir = resolve(root, STORAGE_DIRNAME, "message", sessionId);
	if (existsSync(messagesDir)) {
		let entries: Dirent[];
		try {
			entries = await readdir(messagesDir, { withFileTypes: true });
		} catch {
			entries = [];
		}
		const files = entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
			.map((entry) => entry.name)
			.sort((left, right) => left.localeCompare(right));

		for (const file of files) {
			const messageId = basename(file, ".json");
			const data = await readJsonFile(resolve(messagesDir, file));
			if (!data) continue;
			const role = typeof data.role === "string" ? data.role : "";
			const type =
				role === "user" ? "user" : role === "assistant" ? "assistant" : null;
			if (!type) continue;

			const documents = await readStoragePartDocuments(root, messageId);
			const extracted = extractPartDocuments(documents);
			if (!extracted.text && !extracted.thinking && !extracted.hasToolUse) {
				continue;
			}
			messages.push(
				buildParsedMessage(
					messageId,
					type,
					extracted,
					isoOr(readTimeObject(data.time), fallbackTimestamp),
				),
			);
		}
	}

	return assembleConversation(
		meta,
		directory,
		title,
		messages,
		sessionCreated,
		fallbackTimestamp,
	);
}

// =============================================
// Conversation assembly
// =============================================

function assembleConversation(
	meta: ConversationMeta,
	directory: string,
	title: string,
	messages: ParsedMessage[],
	sessionCreatedMs: number | null,
	fallbackTimestamp: string,
): ParsedConversation {
	const startTimestamp =
		messages[0]?.timestamp ??
		isoOr(sessionCreatedMs, fallbackTimestamp);
	return {
		id: meta.id,
		slug: sessionSlug(title),
		source: SOURCE_NAME,
		projectDir: directory,
		projectName: projectNameFromDirectory(directory, "OpenCode"),
		cwd: directory || null,
		gitBranch: null,
		messages,
		firstMessageAt: startTimestamp,
		lastMessageAt: messages[messages.length - 1]?.timestamp ?? startTimestamp,
	};
}

function emptyConversation(meta: ConversationMeta): ParsedConversation {
	const fallbackTimestamp = normalizeIsoOrFallback(meta.fileMtime);
	return assembleConversation(
		meta,
		meta.projectDir,
		"",
		[],
		null,
		fallbackTimestamp,
	);
}

// =============================================
// Per-root discovery
// =============================================

/**
 * Conversations one root holds: the SQLite store when it has sessions,
 * otherwise the legacy JSON storage (the 1.x files are ignored once a database
 * exists, because they are what the database was built from).
 */
async function collectRoot(root: string): Promise<ConversationMeta[]> {
	const dbPath = getDatabasePath(root);
	if (existsSync(dbPath)) {
		const db = await openDatabase(dbPath);
		if (db) {
			const sessions = listSessions(db);
			if (sessions.length > 0) {
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
		}
	}
	return await scanStorage(root);
}

// =============================================
// OpenCode Adapter
// =============================================

export const opencodeAdapter: SourceAdapter = {
	name: SOURCE_NAME,
	displayName: DISPLAY_NAME,
	parserVersion: PARSER_VERSION,

	async detect(): Promise<SourceInfo | null> {
		try {
			let conversationCount = 0;
			for (const root of dataRoots()) {
				try {
					conversationCount += (await collectRoot(root)).length;
				} catch {
					// A WSL distro can stop mid-scan; keep the other roots.
				}
			}
			if (conversationCount === 0) return null;
			return {
				name: SOURCE_NAME,
				displayName: DISPLAY_NAME,
				dataDir: appConfig.opencodeDataDir,
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
				metas.push(...(await collectRoot(root)));
			} catch {
				// A stopped distro must not abort the local scan.
			}
		}
		return metas;
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		const root = meta.rootDir ?? appConfig.opencodeDataDir;
		const dbPath = getDatabasePath(root);
		try {
			if (meta.filePath === dbPath && existsSync(dbPath)) {
				const db = await openDatabase(dbPath);
				if (db) {
					const located = readSession(db, meta.id);
					if (located) {
						const fallbackTimestamp = normalizeIsoOrFallback(meta.fileMtime);
						const messages =
							located.store === "v2"
								? readV2Messages(db, meta.id, fallbackTimestamp)
								: readV1Messages(db, meta.id, fallbackTimestamp);
						return assembleConversation(
							meta,
							located.info.directory,
							located.info.title,
							messages,
							located.info.timeCreated > 0 ? located.info.timeCreated : null,
							fallbackTimestamp,
						);
					}
				}
			}
			if (meta.filePath !== dbPath) {
				return await parseStorageConversation(meta);
			}
		} catch (err) {
			console.warn(
				`[OpenCode] Failed to parse ${meta.filePath}:`,
				err instanceof Error ? err.message : err,
			);
		}
		return emptyConversation(meta);
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
		const storageDir = resolve(appConfig.opencodeDataDir, STORAGE_DIRNAME);
		if (existsSync(storageDir)) {
			paths.push(resolve(storageDir, "**", "*.json"));
		}
		return paths;
	},
};
