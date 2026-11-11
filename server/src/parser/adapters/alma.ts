/**
 * Alma adapter.
 *
 * Alma (the desktop AI chat app) keeps all chats in one SQLite database,
 * `chat_threads.db`, inside its Electron userData folder:
 *
 *  - `chat_threads`: id, title ("New Chat" until it has one), model, created_at
 *    / updated_at (ISO strings), workspace_id (→ `workspaces.path`, the folder
 *    it works in), is_incognito, metadata (`{"isCron":…}`);
 *  - `chat_messages`: id, thread_id, parent_id / slot_id / depth (an edit tree),
 *    message (the AI SDK's UIMessage as JSON: `{ id, role, parts }` — text,
 *    reasoning, step-start, file, `tool-<Name>` with its input/output,
 *    `dynamic-tool` with toolName), timestamp, metadata
 *    (`{"isCompactionIndicator":…}`), and parent_tool_call_id on a subagent's
 *    messages.
 *
 * Only the main conversation is imported: subagent messages (a non-empty
 * parent_tool_call_id), compaction indicator notes, incognito chats and the
 * thousands of chats Alma's scheduled tasks run in are left out.
 *
 * Alma is a desktop application read from its local data folder, so only the
 * primary root is scanned (magpie reads exactly the same local store). The
 * adapter still routes discovery through a root list so a WSL layout can be
 * added without reshaping it.
 */

import { existsSync } from "node:fs";
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
import { openVscdb } from "../vscdb.js";

const SOURCE_NAME = "alma";
const DISPLAY_NAME = "Alma";
const PARSER_VERSION = "alma@1";

const DB_FILE = "chat_threads.db";
/** Alma names a chat this until it generates a real title. */
const PLACEHOLDER_TITLE = "New Chat";
/** Scheduled-task chats: flagged in metadata, or titled before the flag. */
const CRON_TITLE_PREFIX = "⏰ Cron:";

type SqlValue = number | string | Uint8Array | null;

// =============================================
// Data roots and database file
// =============================================

/** Alma's local data folder (desktop app; no WSL root is read). */
function dataRoots(): string[] {
	return [appConfig.almaDataDir];
}

function getDatabasePath(root: string = appConfig.almaDataDir): string {
	return resolve(root, DB_FILE);
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

async function databaseSignature(dbPath: string): Promise<string | null> {
	let main: Awaited<ReturnType<typeof stat>>;
	try {
		main = await stat(dbPath);
	} catch {
		return null;
	}
	let signature = `${main.size}:${main.mtimeMs}`;
	// Alma keeps SQLite in WAL mode and writes it the whole time it runs.
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

function columnsOf(db: Database, table: string): Set<string> {
	try {
		const result = db.exec(`PRAGMA table_info("${table}")`);
		const rows = result[0]?.values ?? [];
		return new Set(rows.map((row) => String(row[1] ?? "")));
	} catch {
		return new Set();
	}
}

function columnOr(columns: Set<string>, name: string, fallback: string): string {
	return columns.has(name) ? name : fallback;
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

/** Normalize an Alma ISO timestamp; `fallback` when it is missing/invalid. */
function isoOr(value: unknown, fallback: string): string {
	if (typeof value === "string" && value.trim()) {
		const parsed = Date.parse(value);
		if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
	}
	return fallback;
}

function normalizeIsoOrFallback(value: string): string {
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? new Date(0).toISOString() : value;
}

/** Whether a thread row is an incognito chat or a scheduled task's chat. */
function isHiddenThread(options: {
	isIncognito: number;
	metadata: string;
	title: string;
}): boolean {
	if (options.isIncognito !== 0) return true;
	if (options.title.startsWith(CRON_TITLE_PREFIX)) return true;
	const metadata = parseJson(options.metadata);
	if (metadata && typeof metadata === "object") {
		const record = metadata as Record<string, unknown>;
		if (record.isCron === true || record.isCron === 1) return true;
	}
	return false;
}

// =============================================
// UIMessage content extraction
// =============================================

interface ExtractedContent {
	text: string;
	thinking: string | null;
	hasToolUse: boolean;
}

/**
 * Extract the transcript text from an AI SDK UIMessage's `parts` array.
 * Text parts become the body, reasoning parts the thinking; a `tool-<Name>` or
 * `dynamic-tool` part only marks the assistant turn as tool-using (tool input
 * and output are not conversation text). file/step-start/... parts are noise.
 */
function extractParts(parts: unknown): ExtractedContent {
	const texts: string[] = [];
	const thoughts: string[] = [];
	let hasToolUse = false;

	const visit = (part: unknown): void => {
		if (!part || typeof part !== "object") return;
		const record = part as Record<string, unknown>;
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
		if (type.startsWith("tool-") || type === "dynamic-tool") {
			hasToolUse = true;
		}
	};

	if (Array.isArray(parts)) {
		for (const part of parts) visit(part);
	}

	return {
		text: texts.join("\n").trim(),
		thinking: thoughts.length > 0 ? thoughts.join("\n") : null,
		hasToolUse,
	};
}

/** Read a UIMessage JSON document; null when it is unreadable. */
function parseUiMessage(raw: unknown): Record<string, unknown> | null {
	const parsed = parseJson(raw);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}
	return parsed as Record<string, unknown>;
}

function isCompactionIndicator(metadata: unknown): boolean {
	const parsed = parseJson(metadata);
	if (!parsed || typeof parsed !== "object") return false;
	return (
		(parsed as Record<string, unknown>).isCompactionIndicator === true
	);
}

// =============================================
// Workspaces and threads
// =============================================

function readWorkspacePaths(
	db: Database,
	workspaceColumns: Set<string>,
): Map<string, string> {
	const paths = new Map<string, string>();
	if (!workspaceColumns.has("id") || !workspaceColumns.has("path")) {
		return paths;
	}
	let values: SqlValue[][] = [];
	try {
		values =
			db.exec(`SELECT id AS id, COALESCE(path, '') AS path FROM workspaces`)[0]
				?.values ?? [];
	} catch {
		return paths;
	}
	for (const row of values) {
		const id = String(row[0] ?? "");
		const path = String(row[1] ?? "");
		if (id && path) paths.set(id, path);
	}
	return paths;
}

interface ThreadRow {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	workspaceId: string;
	isIncognito: number;
	metadata: string;
}

function listThreads(
	db: Database,
	threadColumns: Set<string>,
): ThreadRow[] {
	if (!threadColumns.has("id")) return [];
	const sql = [
		"SELECT id AS id,",
		`COALESCE(${columnOr(threadColumns, "title", "NULL")}, '') AS title,`,
		`COALESCE(${columnOr(threadColumns, "created_at", "NULL")}, '') AS created_at,`,
		`COALESCE(${columnOr(threadColumns, "updated_at", "NULL")}, '') AS updated_at,`,
		`COALESCE(${columnOr(threadColumns, "workspace_id", "NULL")}, '') AS workspace_id,`,
		`COALESCE(${columnOr(threadColumns, "is_incognito", "0")}, 0) AS is_incognito,`,
		`COALESCE(${columnOr(threadColumns, "metadata", "'{}'")}, '{}') AS metadata`,
		"FROM chat_threads",
	].join(" ");

	let values: SqlValue[][] = [];
	try {
		values = db.exec(sql)[0]?.values ?? [];
	} catch {
		return [];
	}
	return values
		.map((row) => ({
			id: String(row[0] ?? ""),
			title: String(row[1] ?? ""),
			createdAt: String(row[2] ?? ""),
			updatedAt: String(row[3] ?? ""),
			workspaceId: String(row[4] ?? ""),
			isIncognito: Number(row[5] ?? 0),
			metadata: String(row[6] ?? ""),
		}))
		.filter((thread) => thread.id);
}

interface MessageStats {
	count: number;
	lastTimestamp: string;
}

function readMessageStats(
	db: Database,
	messageColumns: Set<string>,
): Map<string, MessageStats> {
	const stats = new Map<string, MessageStats>();
	if (!messageColumns.has("thread_id")) return stats;
	const timestampColumn = messageColumns.has("timestamp")
		? "timestamp"
		: messageColumns.has("created_at")
			? "created_at"
			: "''";
	let values: SqlValue[][] = [];
	try {
		values =
			db.exec(
				`SELECT thread_id AS tid, COUNT(*) AS n, COALESCE(MAX(${timestampColumn}), '') AS last FROM chat_messages GROUP BY thread_id`,
			)[0]?.values ?? [];
	} catch {
		return stats;
	}
	for (const row of values) {
		const threadId = String(row[0] ?? "");
		if (!threadId) continue;
		stats.set(threadId, {
			count: Number(row[1] ?? 0),
			lastTimestamp: String(row[2] ?? ""),
		});
	}
	return stats;
}

// =============================================
// Per-root discovery
// =============================================

async function scanStore(root: string): Promise<ConversationMeta[]> {
	const dbPath = getDatabasePath(root);
	const db = await openDatabase(dbPath);
	if (!db) return [];

	const threadColumns = columnsOf(db, "chat_threads");
	const messageColumns = columnsOf(db, "chat_messages");
	if (
		!threadColumns.has("id") ||
		!messageColumns.has("thread_id") ||
		!messageColumns.has("message")
	) {
		return [];
	}

	const workspacePaths = readWorkspacePaths(
		db,
		columnsOf(db, "workspaces"),
	);
	const messageStats = readMessageStats(db, messageColumns);
	const threads = listThreads(db, threadColumns);

	let fallbackMtime = new Date(0).toISOString();
	try {
		fallbackMtime = (await stat(dbPath)).mtime.toISOString();
	} catch {
		// The database disappeared mid-scan; thread timestamps still order it.
	}

	const metas: ConversationMeta[] = [];
	for (const thread of threads) {
		if (isHiddenThread(thread)) continue;
		const stats = messageStats.get(thread.id);
		// A chat opened and left has nothing to import.
		if (!stats || stats.count === 0) continue;

		const updatedMs = Date.parse(isoOr(thread.updatedAt, fallbackMtime));
		const lastMessageMs = Date.parse(
			isoOr(stats.lastTimestamp, fallbackMtime),
		);
		const newestMs = Number.isNaN(updatedMs)
			? lastMessageMs
			: Math.max(updatedMs, Number.isNaN(lastMessageMs) ? 0 : lastMessageMs);

		metas.push({
			id: thread.id,
			source: SOURCE_NAME,
			filePath: dbPath,
			// One database holds every chat: the per-chat updated_at is the
			// change signal, so the shared file size stays constant.
			fileSize: 0,
			fileMtime: Number.isNaN(newestMs)
				? fallbackMtime
				: new Date(newestMs).toISOString(),
			projectDir: workspacePaths.get(thread.workspaceId) ?? "",
			rootDir: root,
		});
	}
	return metas;
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

function readConversationMessages(
	db: Database,
	messageColumns: Set<string>,
	threadId: string,
	fallbackTimestamp: string,
): ParsedMessage[] {
	if (!messageColumns.has("thread_id") || !messageColumns.has("message")) {
		return [];
	}
	const sql = [
		`SELECT ${columnOr(messageColumns, "message", "NULL")} AS message,`,
		`COALESCE(${columnOr(messageColumns, "timestamp", "NULL")}, '') AS at,`,
		`COALESCE(${columnOr(messageColumns, "metadata", "'{}'")}, '{}') AS metadata,`,
		`COALESCE(${columnOr(messageColumns, "parent_tool_call_id", "NULL")}, '') AS parent_tool_call_id`,
		"FROM chat_messages",
		"WHERE thread_id = ?",
		`ORDER BY ${columnOr(messageColumns, "timestamp", "rowid")}, rowid`,
	].join(" ");

	let values: SqlValue[][] = [];
	try {
		values = db.exec(sql, [threadId])[0]?.values ?? [];
	} catch {
		return [];
	}

	const messages: ParsedMessage[] = [];
	let index = 0;
	for (const row of values) {
		const uiMessage = parseUiMessage(row[0]);
		if (!uiMessage) {
			index++;
			continue;
		}
		index++;
		const role = String(uiMessage.role ?? "").trim().toLowerCase();
		if (role !== "user" && role !== "assistant") continue;
		// A message spawned inside a tool call is a subagent's work, not the
		// main conversation.
		if (String(row[3] ?? "").trim()) continue;
		if (isCompactionIndicator(row[2])) continue;

		const extracted = extractParts(uiMessage.parts);
		if (!extracted.text && !extracted.thinking && !extracted.hasToolUse) {
			continue;
		}
		const rawId = typeof uiMessage.id === "string" ? uiMessage.id.trim() : "";
		messages.push({
			id: rawId || `${threadId}-${index}`,
			parentUuid: null,
			type: role,
			role,
			content: extracted.text,
			hasToolUse: extracted.hasToolUse,
			hasCode: extracted.text.includes("```"),
			thinking: extracted.thinking,
			timestamp: isoOr(row[1], fallbackTimestamp),
		});
	}
	return messages;
}

async function parseThread(
	meta: ConversationMeta,
	db: Database,
): Promise<ParsedConversation> {
	const threadColumns = columnsOf(db, "chat_threads");
	const messageColumns = columnsOf(db, "chat_messages");

	let thread: ThreadRow | undefined;
	try {
		thread = listThreads(db, threadColumns).find(
			(candidate) => candidate.id === meta.id,
		);
	} catch {
		thread = undefined;
	}
	if (!thread) return emptyConversation(meta);

	const workspacePaths = readWorkspacePaths(db, columnsOf(db, "workspaces"));
	const projectDir =
		workspacePaths.get(thread.workspaceId) ?? meta.projectDir ?? "";
	const fallbackTimestamp = normalizeIsoOrFallback(meta.fileMtime);
	const messages = readConversationMessages(
		db,
		messageColumns,
		meta.id,
		fallbackTimestamp,
	);

	const title = stringOrNull(thread.title);
	const slug = title && title !== PLACEHOLDER_TITLE ? title : null;
	const firstFromThread = isoOr(thread.createdAt, fallbackTimestamp);
	const lastFromThread = isoOr(thread.updatedAt, fallbackTimestamp);

	return {
		id: meta.id,
		slug,
		source: SOURCE_NAME,
		projectDir,
		projectName: projectNameFromPath(projectDir),
		cwd: projectDir || null,
		gitBranch: null,
		messages,
		firstMessageAt: messages[0]?.timestamp ?? firstFromThread,
		lastMessageAt: messages[messages.length - 1]?.timestamp ?? lastFromThread,
	};
}

// =============================================
// Alma Adapter
// =============================================

async function scanSessions(): Promise<ConversationMeta[]> {
	const metas: ConversationMeta[] = [];
	for (const root of dataRoots()) {
		try {
			metas.push(...(await scanStore(root)));
		} catch {
			// An unreadable store must not abort the scan.
		}
	}
	return metas;
}

export const almaAdapter: SourceAdapter = {
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
				dataDir: appConfig.almaDataDir,
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
		return await parseThread(meta, db);
	},

	watchPaths(): string[] {
		// Watch the local desktop database only: Alma is read from its Electron
		// userData folder, and watching `\\wsl.localhost` UNC paths is slow.
		// Alma sessions there (if ever added) sync on the next manual Import.
		const paths: string[] = [];
		const dbPath = getDatabasePath();
		if (existsSync(dbPath)) paths.push(dbPath);
		const walPath = `${dbPath}-wal`;
		if (existsSync(walPath)) paths.push(walPath);
		return paths;
	},
};
