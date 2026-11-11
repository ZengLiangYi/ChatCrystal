import { existsSync, type Stats } from "node:fs";
import { open, readdir, readFile, stat, type FileHandle } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type {
	ConversationMeta,
	ParsedConversation,
	ParsedMessage,
	SourceInfo,
} from "@chatcrystal/shared";
import type { Database } from "sql.js";
import { appConfig } from "../../config.js";
import type { SourceAdapter } from "../adapter.js";
import { withWslRoots } from "../sourceRoots.js";
import { openVscdb } from "../vscdb.js";

/**
 * Block Goose adapter.
 *
 * Goose has two generations of session storage, both supported here:
 *  - current (>= 1.10): `<gooseDataDir>/sessions/sessions.db`, a SQLite store
 *    with a `sessions` table joined to a `messages` table whose `content_json`
 *    column holds an array of content blocks;
 *  - legacy (< 1.10): `<gooseDataDir>/sessions/*.jsonl`, where the first line is
 *    session metadata (`description`, `id`, `working_dir`, `created_at`,
 *    `updated_at`) and every following line is a message with `role`,
 *    `created` (unix seconds or ISO) and `content` blocks.
 *
 * Legacy files stay on disk after goose migrates to SQLite, so scan() prefers
 * the database and skips any legacy file whose id the database already holds.
 *
 * The same layout also lives inside a WSL distro (`~/.local/share/goose`), so
 * every root returned by `withWslRoots` is scanned; databases are opened per
 * root and `meta.rootDir` records where a conversation came from.
 */

const SOURCE = "goose";
const DISPLAY_NAME = "Goose";
const SESSIONS_DIR = "sessions";
const DB_FILE = "sessions.db";
/** Goose's data dir relative to a WSL distro user home. */
const WSL_RELATIVE_DIR = ".local/share/goose";

/** Cap for reading a legacy file's metadata line. */
const FIRST_LINE_BYTES = 64 * 1024;

interface ContentExtraction {
	text: string;
	thinking: string | null;
	hasToolUse: boolean;
}

interface ConversationHeader {
	description: string | null;
	name: string | null;
	workingDir: string | null;
	createdAt: unknown;
	updatedAt: unknown;
}

interface LegacyJsonlFile {
	id: string;
	filePath: string;
	fileSize: number;
	fileMtime: string;
	projectDir: string;
}

interface DbColumnMap {
	sessions: {
		id: string;
		description: string | null;
		name: string | null;
		workingDir: string | null;
		createdAt: string | null;
		updatedAt: string | null;
	};
	messages: {
		sessionId: string;
		role: string;
		content: string;
		created: string | null;
		orderBy: string | null;
		messageId: string | null;
	};
}

interface DbSessionRow {
	id: string;
	description: string | null;
	name: string | null;
	workingDir: string | null;
	createdAt: unknown;
	updatedAt: unknown;
}

interface OpenDatabase {
	db: Database;
	dbPath: string;
	fileSize: number;
	fileMtime: string;
	schema: DbColumnMap;
}

// =============================================
// Paths
// =============================================

/** Data roots to scan: the local install plus every WSL distro home. */
function dataRoots(): string[] {
	return withWslRoots(appConfig.gooseDataDir, WSL_RELATIVE_DIR);
}

function getSessionsDir(root: string = appConfig.gooseDataDir): string {
	return resolve(root, SESSIONS_DIR);
}

function getDbPath(root: string = appConfig.gooseDataDir): string {
	return resolve(getSessionsDir(root), DB_FILE);
}

// =============================================
// Generic helpers
// =============================================

function extractProjectName(projectDir: string): string {
	const normalized = projectDir.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] || projectDir;
}

function stringOrNull(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

/**
 * Normalize a goose timestamp. SQLite stores `created_timestamp` as unix
 * milliseconds while the legacy JSONL format used unix seconds; older rows and
 * SQLite `CURRENT_TIMESTAMP` defaults are ISO-like strings (UTC, no zone).
 */
function toIsoTimestamp(value: unknown, fallback: string): string {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		// Milliseconds since the epoch are ~1e12; seconds are ~1e9.
		const millis = value > 1e11 ? value : value * 1000;
		return new Date(millis).toISOString();
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) return fallback;
		if (/^\d+(\.\d+)?$/.test(trimmed)) {
			return toIsoTimestamp(Number(trimmed), fallback);
		}
		const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(
			trimmed,
		)
			? `${trimmed.replace(" ", "T")}Z`
			: trimmed;
		const parsed = Date.parse(normalized);
		if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
	}
	return fallback;
}

function normalizeBlockType(value: unknown): string {
	return typeof value === "string"
		? value.replace(/[_\-.\s]/g, "").toLowerCase()
		: "";
}

/**
 * Extract conversation text from a goose content payload: either a plain
 * string or a JSON array of content blocks (`text`, `thinking`,
 * `toolRequest`, `toolResponse`, ...). Only `text` becomes body content;
 * `thinking` is kept separately, a `toolRequest` marks tool use, and tool
 * responses/images are dropped as noise.
 */
function extractContent(raw: unknown): ContentExtraction {
	if (typeof raw === "string") {
		return { text: raw.trim(), thinking: null, hasToolUse: false };
	}
	if (!Array.isArray(raw)) {
		return { text: "", thinking: null, hasToolUse: false };
	}

	const texts: string[] = [];
	const thinkingParts: string[] = [];
	let hasToolUse = false;

	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const block = item as { type?: unknown; text?: unknown; thinking?: unknown };
		const type = normalizeBlockType(block.type);
		if (type === "text" && typeof block.text === "string") {
			texts.push(block.text);
		} else if (type === "thinking" && typeof block.thinking === "string") {
			thinkingParts.push(block.thinking);
		} else if (type === "toolrequest" || type === "frontendtoolrequest") {
			hasToolUse = true;
		}
	}

	return {
		text: texts.join("\n").trim(),
		thinking: thinkingParts.length > 0 ? thinkingParts.join("\n") : null,
		hasToolUse,
	};
}

/**
 * `content_json` holds a JSON array; a few legacy rows hold a JSON string or
 * plain text instead, so fall back to the raw value when parsing fails.
 */
function parseContentJson(raw: unknown): unknown {
	if (typeof raw !== "string") return raw;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		return raw;
	}
}

function buildMessage(
	roleValue: unknown,
	content: unknown,
	timestamp: string,
	id: string,
	conversationId: string,
	index: number,
): ParsedMessage | null {
	const role = stringOrNull(roleValue)?.toLowerCase();
	if (role !== "user" && role !== "assistant") return null;

	const extracted = extractContent(content);
	if (!extracted.text && !extracted.thinking && !extracted.hasToolUse) {
		return null;
	}

	return {
		id: id || `${conversationId}-${index}`,
		parentUuid: null,
		type: role,
		role,
		content: extracted.text,
		hasToolUse: extracted.hasToolUse,
		hasCode: extracted.text.includes("```"),
		thinking: extracted.thinking,
		timestamp,
	};
}

function buildConversation(
	meta: ConversationMeta,
	header: ConversationHeader | null,
	messages: ParsedMessage[],
): ParsedConversation {
	const projectDir = stringOrNull(header?.workingDir) ?? meta.projectDir ?? "";
	const slug = stringOrNull(header?.description) ?? stringOrNull(header?.name);
	const createdAt = header?.createdAt ?? meta.fileMtime;
	const updatedAt = header?.updatedAt ?? createdAt;

	return {
		id: meta.id,
		slug,
		source: SOURCE,
		projectDir,
		projectName: projectDir ? extractProjectName(projectDir) : "",
		cwd: projectDir || null,
		gitBranch: null,
		messages,
		firstMessageAt: messages[0]?.timestamp ?? toIsoTimestamp(createdAt, meta.fileMtime),
		lastMessageAt:
			messages[messages.length - 1]?.timestamp ?? toIsoTimestamp(updatedAt, meta.fileMtime),
	};
}

// =============================================
// SQLite store
// =============================================

function readColumns(db: Database, table: string): string[] {
	try {
		const result = db.exec(`PRAGMA table_info("${table}")`);
		return result[0]?.values.map((row) => String(row[1])) ?? [];
	} catch {
		return [];
	}
}

function pickColumn(columns: string[], candidates: string[]): string | null {
	const byLowerName = new Map(columns.map((column) => [column.toLowerCase(), column]));
	for (const candidate of candidates) {
		const match = byLowerName.get(candidate);
		if (match) return match;
	}
	return null;
}

function quoteIdentifier(identifier: string): string {
	return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Probe the goose schema. Column names drifted across goose releases
 * (`id`/`session_id`, `working_dir`/`working_directory`, `description`/`name`,
 * `created_timestamp`/`created_at`/`timestamp`, ...), so instead of relying on
 * one fixed layout we read `PRAGMA table_info` and adapt the queries.
 */
function probeSchema(db: Database): DbColumnMap | null {
	const sessionColumns = readColumns(db, "sessions");
	const messageColumns = readColumns(db, "messages");
	if (sessionColumns.length === 0 || messageColumns.length === 0) return null;

	const sessionId = pickColumn(sessionColumns, ["id", "session_id"]);
	const messageSessionId = pickColumn(messageColumns, ["session_id", "sessionid"]);
	const role = pickColumn(messageColumns, ["role"]);
	const content = pickColumn(messageColumns, ["content_json", "content"]);
	if (!sessionId || !messageSessionId || !role || !content) return null;

	return {
		sessions: {
			id: sessionId,
			description: pickColumn(sessionColumns, ["description"]),
			name: pickColumn(sessionColumns, ["name", "title"]),
			workingDir: pickColumn(sessionColumns, [
				"working_dir",
				"working_directory",
				"cwd",
			]),
			createdAt: pickColumn(sessionColumns, ["created_at", "created"]),
			updatedAt: pickColumn(sessionColumns, ["updated_at"]),
		},
		messages: {
			sessionId: messageSessionId,
			role,
			content,
			created: pickColumn(messageColumns, [
				"created_timestamp",
				"created_at",
				"created",
				"timestamp",
			]),
			orderBy: pickColumn(messageColumns, ["id"]),
			messageId: pickColumn(messageColumns, ["message_id"]),
		},
	};
}

// One sql.js database handle is reused across detect() -> scan() -> parse() per
// database path; the in-memory copy is only refreshed when the file on disk
// changes. Keying by path keeps the local install and a WSL distro apart.
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

async function openDatabase(dbPath: string): Promise<OpenDatabase | null> {
	if (!existsSync(dbPath)) return null;

	let fileStat: Stats;
	try {
		fileStat = await stat(dbPath);
	} catch {
		return null;
	}

	const signature = `${fileStat.size}:${fileStat.mtimeMs}`;
	let db: Database;
	const cached = dbCache.get(dbPath);
	if (cached && cached.signature === signature) {
		db = cached.db;
	} else {
		closeCachedDb(dbPath);
		const opened = await openVscdb(dbPath);
		if (!opened) return null;
		db = opened;
		dbCache.set(dbPath, { signature, db });
	}

	const schema = probeSchema(db);
	if (!schema) return null;

	return {
		db,
		dbPath,
		fileSize: fileStat.size,
		fileMtime: new Date(fileStat.mtimeMs).toISOString(),
		schema,
	};
}

function selectDbSessions(db: Database, schema: DbColumnMap): DbSessionRow[] {
	const session = schema.sessions;
	const columns = [
		`${quoteIdentifier(session.id)} AS id`,
		session.description
			? `${quoteIdentifier(session.description)} AS description`
			: "NULL AS description",
		session.name ? `${quoteIdentifier(session.name)} AS name` : "NULL AS name",
		session.workingDir
			? `${quoteIdentifier(session.workingDir)} AS working_dir`
			: "NULL AS working_dir",
		session.createdAt
			? `${quoteIdentifier(session.createdAt)} AS created_at`
			: "NULL AS created_at",
		session.updatedAt
			? `${quoteIdentifier(session.updatedAt)} AS updated_at`
			: "NULL AS updated_at",
	];
	const orderBy = session.createdAt
		? quoteIdentifier(session.createdAt)
		: session.updatedAt
			? quoteIdentifier(session.updatedAt)
			: "rowid";
	const result = db.exec(
		`SELECT ${columns.join(", ")} FROM "sessions" ORDER BY ${orderBy}`,
	);
	const rows = result[0]?.values ?? [];

	const sessions: DbSessionRow[] = [];
	for (const row of rows) {
		const id = String(row[0] ?? "");
		if (!id) continue;
		sessions.push({
			id,
			description: stringOrNull(row[1]),
			name: stringOrNull(row[2]),
			workingDir: stringOrNull(row[3]),
			createdAt: row[4],
			updatedAt: row[5],
		});
	}
	return sessions;
}

function selectDbMessages(
	db: Database,
	schema: DbColumnMap,
	sessionId: string,
	fallbackTimestamp: string,
): ParsedMessage[] {
	const message = schema.messages;
	const created = message.created
		? `${quoteIdentifier(message.created)} AS created`
		: "NULL AS created";
	const messageId = message.messageId
		? `${quoteIdentifier(message.messageId)} AS message_id`
		: "NULL AS message_id";
	const orderBy = [message.created, message.orderBy]
		.filter((column): column is string => Boolean(column))
		.map(quoteIdentifier)
		.join(", ");
	const sql = `SELECT ${quoteIdentifier(message.role)} AS role, ${quoteIdentifier(
		message.content,
	)} AS content, ${created}, ${messageId} FROM "messages" WHERE ${quoteIdentifier(
		message.sessionId,
	)} = ?${orderBy ? ` ORDER BY ${orderBy}` : ""}`;

	const result = db.exec(sql, [sessionId]);
	const rows = result[0]?.values ?? [];
	const messages: ParsedMessage[] = [];
	for (const row of rows) {
		const timestamp = toIsoTimestamp(row[2], fallbackTimestamp);
		const id = row[3] ? String(row[3]) : "";
		const parsed = buildMessage(
			row[0],
			parseContentJson(row[1]),
			timestamp,
			id,
			sessionId,
			messages.length,
		);
		if (parsed) messages.push(parsed);
	}
	return messages;
}

async function parseSqlite(meta: ConversationMeta): Promise<ParsedConversation> {
	const dbPath = resolve(meta.filePath);
	const store = await openDatabase(dbPath);
	if (!store) return buildConversation(meta, null, []);

	let dbSessions: DbSessionRow[] = [];
	try {
		dbSessions = selectDbSessions(store.db, store.schema);
	} catch {
		return buildConversation(meta, null, []);
	}
	const session = dbSessions.find((candidate) => candidate.id === meta.id) ?? null;
	const header: ConversationHeader | null = session
		? {
				description: session.description,
				name: session.name,
				workingDir: session.workingDir,
				createdAt: session.createdAt,
				updatedAt: session.updatedAt,
			}
		: null;

	let messages: ParsedMessage[] = [];
	try {
		messages = selectDbMessages(
			store.db,
			store.schema,
			meta.id,
			meta.fileMtime,
		);
	} catch {
		messages = [];
	}

	return buildConversation(meta, header, messages);
}

// =============================================
// Legacy JSONL store
// =============================================

async function readFirstLine(filePath: string): Promise<string | null> {
	let handle: FileHandle | null = null;
	try {
		handle = await open(filePath, "r");
		const buffer = Buffer.alloc(FIRST_LINE_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		if (bytesRead === 0) return null;
		const chunk = buffer.subarray(0, bytesRead).toString("utf-8");
		const newlineIndex = chunk.indexOf("\n");
		return newlineIndex >= 0 ? chunk.slice(0, newlineIndex) : chunk;
	} catch {
		return null;
	} finally {
		await handle?.close();
	}
}

function isLegacyMetadata(record: Record<string, unknown>): boolean {
	if (typeof record.role === "string") return false;
	return (
		typeof record.id === "string" ||
		typeof record.description === "string" ||
		typeof record.working_dir === "string" ||
		typeof record.created_at !== "undefined" ||
		typeof record.updated_at !== "undefined"
	);
}

async function findLegacyJsonlFiles(root: string): Promise<LegacyJsonlFile[]> {
	const sessionsDir = getSessionsDir(root);
	if (!existsSync(sessionsDir)) return [];

	const files: LegacyJsonlFile[] = [];
	try {
		const entries = await readdir(sessionsDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
			const filePath = resolve(sessionsDir, entry.name);
			try {
				const fileStat = await stat(filePath);
				const metadata = await readLegacyMetadata(filePath);
				files.push({
					id:
						stringOrNull(metadata?.id) ?? basename(filePath, ".jsonl"),
					filePath,
					fileSize: fileStat.size,
					fileMtime: fileStat.mtime.toISOString(),
					projectDir: stringOrNull(metadata?.working_dir) ?? "",
				});
			} catch {
				// Unreadable legacy file.
			}
		}
	} catch {
		// Sessions directory unreadable.
	}
	return files;
}

async function readLegacyMetadata(
	filePath: string,
): Promise<Record<string, unknown> | null> {
	const firstLine = await readFirstLine(filePath);
	if (!firstLine) return null;
	try {
		const parsed = JSON.parse(firstLine.replace(/^\uFEFF/, "")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		const record = parsed as Record<string, unknown>;
		return isLegacyMetadata(record) ? record : null;
	} catch {
		return null;
	}
}

async function parseLegacyJsonl(meta: ConversationMeta): Promise<ParsedConversation> {
	let content: string;
	try {
		content = await readFile(meta.filePath, "utf-8");
	} catch {
		return buildConversation(meta, null, []);
	}

	const messages: ParsedMessage[] = [];
	let header: ConversationHeader | null = null;
	let firstContentLine = true;

	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;

		let parsed: unknown;
		try {
			parsed = JSON.parse(line.replace(/^\uFEFF/, ""));
		} catch {
			continue; // Skip malformed lines.
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
		const record = parsed as Record<string, unknown>;

		if (firstContentLine) {
			firstContentLine = false;
			if (isLegacyMetadata(record)) {
				header = {
					description: stringOrNull(record.description),
					name: stringOrNull(record.name) ?? stringOrNull(record.title),
					workingDir: stringOrNull(record.working_dir),
					createdAt: record.created_at,
					updatedAt: record.updated_at,
				};
				continue;
			}
		}

		if (typeof record.role !== "string") continue;
		const timestamp = toIsoTimestamp(
			record.created ?? record.timestamp ?? record.created_at,
			meta.fileMtime,
		);
		const message = buildMessage(
			record.role,
			record.content,
			timestamp,
			stringOrNull(record.id) ?? "",
			meta.id,
			messages.length,
		);
		if (message) messages.push(message);
	}

	return buildConversation(meta, header, messages);
}

// =============================================
// Goose Adapter
// =============================================

/**
 * Conversations one goose data root holds. The database is the source of truth
 * for ids it already holds; legacy JSONL files are only read for sessions the
 * DB has not migrated yet. Dedup is per root, so a WSL distro keeps its own
 * sessions even when a local legacy file shares an id.
 */
async function scanRoot(root: string): Promise<ConversationMeta[]> {
	const metas: ConversationMeta[] = [];
	const seenIds = new Set<string>();

	const store = await openDatabase(getDbPath(root));
	if (store) {
		try {
			for (const session of selectDbSessions(store.db, store.schema)) {
				seenIds.add(session.id);
				metas.push({
					id: session.id,
					source: SOURCE,
					filePath: store.dbPath,
					// The database file is shared by every session, so its size
					// cannot say which session changed. Use the per-session
					// updated_at as the change signal instead (and a constant size
					// so a write to one session does not re-import all of them).
					fileSize: 0,
					fileMtime: toIsoTimestamp(
						session.updatedAt ?? session.createdAt,
						store.fileMtime,
					),
					projectDir: session.workingDir ?? "",
					rootDir: root,
				});
			}
		} catch {
			// Schema drift: fall through to legacy files.
		}
	}

	for (const file of await findLegacyJsonlFiles(root)) {
		// Legacy files survive the migration to SQLite; the database is the
		// source of truth for ids it already holds.
		if (seenIds.has(file.id)) continue;
		seenIds.add(file.id);
		metas.push({
			id: file.id,
			source: SOURCE,
			filePath: file.filePath,
			fileSize: file.fileSize,
			fileMtime: file.fileMtime,
			projectDir: file.projectDir,
			rootDir: root,
		});
	}

	return metas;
}

async function scanSessions(): Promise<ConversationMeta[]> {
	const metas: ConversationMeta[] = [];
	for (const root of dataRoots()) {
		try {
			metas.push(...(await scanRoot(root)));
		} catch {
			// A stopped distro must not abort the local scan.
		}
	}
	return metas;
}

export const gooseAdapter: SourceAdapter = {
	name: SOURCE,
	displayName: DISPLAY_NAME,
	parserVersion: "goose@2",

	async detect(): Promise<SourceInfo | null> {
		try {
			let conversationCount = 0;
			for (const root of dataRoots()) {
				if (!existsSync(root)) continue;
				try {
					conversationCount += (await scanRoot(root)).length;
				} catch {
					// A WSL distro can stop mid-scan; keep the other roots.
				}
			}
			if (conversationCount === 0) return null;

			return {
				name: SOURCE,
				displayName: DISPLAY_NAME,
				dataDir: appConfig.gooseDataDir,
				conversationCount,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		return scanSessions();
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		return basename(meta.filePath).toLowerCase() === DB_FILE
			? parseSqlite(meta)
			: parseLegacyJsonl(meta);
	},

	watchPaths(): string[] {
		// Watch the local install only: watching `\\wsl.localhost` UNC paths is
		// slow and would start stopped distros. WSL sessions are picked up on the
		// next manual Import.
		const targets: string[] = [];
		const dbPath = getDbPath();
		if (existsSync(dbPath)) targets.push(dbPath);
		const sessionsDir = getSessionsDir();
		if (existsSync(sessionsDir)) {
			targets.push(resolve(sessionsDir, "*.jsonl"));
		}
		return targets;
	},
};
