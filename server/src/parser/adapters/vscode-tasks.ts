/**
 * Shared parsing helpers for the "Cline lineage" VS Code agent extensions.
 *
 * Cline's legacy VS Code extension (`saoudrizwan.claude-dev`), Roo Code and
 * Kilo Code all store one directory per task under
 * `<globalStorage>/tasks/<taskId>/`:
 *
 * - `api_conversation_history.json` — the whole Anthropic-shaped transcript,
 *   a JSON array of `{ role, content }` turns where `content` is either a
 *   string or an array of `{ type: 'text' | 'thinking' | 'tool_use' | ... }`
 *   blocks. The file is rewritten whole on every change.
 * - `history_item.json` (Roo Code / Kilo Code) or `<root>/state/taskHistory.json`
 *   (Cline legacy extension) — per-task metadata: `id`, epoch-ms `ts`, the
 *   first `task` prompt and the `workspace` the task ran in.
 *
 * The transcripts carry no per-message timestamps, so a task's history `ts`
 * (falling back to the transcript's file mtime) is used as the base and every
 * kept message is advanced one second to keep a stable order.
 *
 * A task store can also live inside a WSL distro home (VS Code Remote keeps it
 * under `.vscode-server/data/User/globalStorage`). Callers scan every root and
 * `scanVscodeTasks` stamps `meta.rootDir`; `parseVscodeTask` reads the Cline
 * legacy `state/taskHistory.json` index from that root, so a WSL task's
 * metadata is found even though it is not beside the primary install.
 *
 * A handful of the generic JSON helpers below are also reused by the Continue
 * adapter, whose session files have a similar whole-file JSON shape.
 */

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type {
	ConversationMeta,
	ParsedConversation,
	ParsedMessage,
} from "@chatcrystal/shared";

// =============================================
// Types
// =============================================

/** Where a Cline-lineage extension generation keeps per-task metadata. */
export type VscodeTaskHistoryMode = "per-task" | "task-history" | "none";

/**
 * Metadata of a single task.
 * Roo Code / Kilo Code write one `history_item.json` per task; Cline's legacy
 * extension keeps an array of these in `state/taskHistory.json`.
 */
export interface VscodeTaskHistory {
	id?: string;
	/** Epoch milliseconds of the task's creation time. */
	ts?: number;
	/** The task's first prompt, used as a title fallback. */
	task?: string;
	/** Absolute path of the workspace the task ran in. */
	workspace?: string;
}

/** Identifies one Cline-lineage task store under a VS Code globalStorage root. */
export interface VscodeTaskRoot {
	/** globalStorage directory that holds the `tasks/` folder (and `state/`). */
	root: string;
	/** ChatCrystal source id stamped on scan/parse results. */
	source: string;
	/** Metadata layout used by the extension generation. */
	history: VscodeTaskHistoryMode;
}

/** Extraction result for one Anthropic-shaped message `content` value. */
export interface ContentExtraction {
	text: string;
	thinking: string | null;
	hasToolUse: boolean;
	hasCode: boolean;
}

// =============================================
// Generic JSON / path helpers
// =============================================

/** Parse a JSON file, returning null for missing, unreadable or corrupt files. */
export async function readJsonFile(filePath: string): Promise<unknown> {
	try {
		return JSON.parse(await readFile(filePath, "utf-8")) as unknown;
	} catch {
		// Missing or half-written file: the caller treats this as "no data" and
		// re-reads on the next scan instead of failing the whole source.
		return null;
	}
}

/** Narrow an unknown JSON value to a plain object. */
export function toRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

/**
 * Return `value` itself when it is an array, otherwise the first array found
 * under one of `keys` on an object. Anything else yields an empty array.
 */
export function asArrayField(
	value: unknown,
	keys: readonly string[] = [],
): unknown[] {
	if (Array.isArray(value)) return value;
	const record = toRecord(value);
	if (!record) return [];
	for (const key of keys) {
		const candidate = record[key];
		if (Array.isArray(candidate)) return candidate;
	}
	return [];
}

/** Convert an epoch-ms number or an ISO date string to epoch milliseconds. */
export function toEpochMs(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		if (!Number.isNaN(parsed)) return parsed;
	}
	return null;
}

/** Decode a `file://` URI into a local path; non-URI values pass through. */
export function decodeFileUri(value: string): string {
	if (!value.startsWith("file:")) return value;
	let decoded = value.replace(/^file:\/\//, "");
	try {
		decoded = decodeURIComponent(decoded);
	} catch {
		return decoded;
	}
	// `file:///C:/...` decodes to `/C:/...`; drop the URI-style leading slash.
	if (/^\/[A-Za-z]:[\\/]/.test(decoded)) return decoded.slice(1);
	return decoded;
}

/** Last path segment of a workspace path, or "Unknown" when unavailable. */
export function projectNameFromDir(projectDir: string): string {
	const normalized = decodeFileUri(projectDir)
		.replace(/\\/g, "/")
		.replace(/\/+$/, "");
	const segments = normalized.split("/").filter(Boolean);
	return segments[segments.length - 1] ?? "Unknown";
}

/** Collapse whitespace and cap a prompt/title for use as a conversation slug. */
export function truncateSlug(text: string, maxLength = 80): string | null {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return null;
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, Math.max(1, maxLength - 3))}...`;
}

/**
 * Strip the `<task>...</task>` envelope the legacy Cline/Roo/Kilo extensions
 * wrap the first user prompt in. Only whole-string wrappers are unwrapped.
 */
export function unwrapTaskEnvelope(text: string): string {
	const trimmed = text.trim();
	const match = /^<task>([\s\S]*)<\/task>$/.exec(trimmed);
	return match?.[1] ? match[1].trim() : trimmed;
}

/**
 * Accumulate an optional companion file's size/mtime into a scan entry.
 * Cline CLI rewrites its `<id>.json` manifest (title, status) and Roo rewrites
 * `history_item.json`; folding them into the meta keeps the import service's
 * size+mtime dedup from skipping a conversation whose transcript did not move.
 */
export async function mergeCompanionFile(
	times: { size: number; mtime: Date },
	filePath: string,
): Promise<void> {
	const companionStat = await stat(filePath).catch(() => null);
	if (!companionStat?.isFile()) return;
	times.size += companionStat.size;
	if (companionStat.mtime > times.mtime) times.mtime = companionStat.mtime;
}

// =============================================
// Content extraction
// =============================================

/**
 * Extract text/thinking/tool flags from an Anthropic-shaped `content` value:
 * either a plain string or an array of `{ type, text | thinking }` blocks.
 *
 * `tool_use` blocks set `hasToolUse`; their raw `input` is deliberately not
 * copied into the transcript. `tool_result` blocks are tool output noise for
 * this transcript view and are skipped.
 */
export function extractContentText(content: unknown): ContentExtraction {
	if (typeof content === "string") {
		const text = content.trim();
		return {
			text,
			thinking: null,
			hasToolUse: false,
			hasCode: text.includes("```"),
		};
	}

	const texts: string[] = [];
	const thinking: string[] = [];
	let hasToolUse = false;

	for (const raw of asArrayField(content)) {
		const block = toRecord(raw);
		if (!block) continue;
		const type = typeof block.type === "string" ? block.type : "";
		const blockText = typeof block.text === "string" ? block.text : null;
		if (type === "text") {
			if (blockText !== null) texts.push(blockText);
		} else if (type === "thinking") {
			if (typeof block.thinking === "string") thinking.push(block.thinking);
			else if (blockText !== null) thinking.push(blockText);
		} else if (type === "tool_use") {
			hasToolUse = true;
		}
	}

	const text = texts.join("\n").trim();
	return {
		text,
		thinking: thinking.length > 0 ? thinking.join("\n") : null,
		hasToolUse,
		hasCode: text.includes("```"),
	};
}

// =============================================
// Task history metadata
// =============================================

interface TaskHistoryIndexCacheEntry {
	mtimeMs: number;
	index: Map<string, VscodeTaskHistory>;
}

/** Cache of `<root>/state/taskHistory.json`, invalidated by mtime. */
const taskHistoryIndexCache = new Map<string, TaskHistoryIndexCacheEntry>();

function parseHistoryEntry(value: unknown): VscodeTaskHistory | null {
	const record = toRecord(value);
	if (!record) return null;
	const ts = toEpochMs(record.ts);
	return {
		id: typeof record.id === "string" ? record.id : undefined,
		ts: ts ?? undefined,
		task: typeof record.task === "string" ? record.task : undefined,
		workspace:
			typeof record.workspace === "string" ? record.workspace : undefined,
	};
}

async function readTaskHistoryItem(
	taskDir: string,
): Promise<VscodeTaskHistory | null> {
	return parseHistoryEntry(
		await readJsonFile(resolve(taskDir, "history_item.json")),
	);
}

async function loadTaskHistoryIndex(
	root: string,
): Promise<Map<string, VscodeTaskHistory>> {
	const indexPath = resolve(root, "state", "taskHistory.json");
	const indexStat = await stat(indexPath).catch(() => null);
	if (!indexStat?.isFile()) {
		taskHistoryIndexCache.delete(indexPath);
		return new Map();
	}
	const cached = taskHistoryIndexCache.get(indexPath);
	if (cached && cached.mtimeMs === indexStat.mtimeMs) return cached.index;

	const raw = await readJsonFile(indexPath);
	const entries = asArrayField(raw, ["history", "taskHistory"]);
	const index = new Map<string, VscodeTaskHistory>();
	for (const entry of entries) {
		const history = parseHistoryEntry(entry);
		if (history?.id) index.set(history.id, history);
	}
	taskHistoryIndexCache.set(indexPath, { mtimeMs: indexStat.mtimeMs, index });
	return index;
}

async function loadTaskHistory(
	config: VscodeTaskRoot,
	taskId: string,
	taskDir: string,
): Promise<VscodeTaskHistory | null> {
	if (config.history === "none") return null;
	if (config.history === "per-task") return readTaskHistoryItem(taskDir);
	const index = await loadTaskHistoryIndex(config.root);
	return index.get(taskId) ?? null;
}

// =============================================
// Scanning
// =============================================

/**
 * Scan `<root>/tasks/<taskId>/api_conversation_history.json` files.
 * Corrupt or missing task directories are skipped instead of failing the scan.
 * Every meta records the scanned root so a later `parse()` can locate root-level
 * metadata (Cline's `state/taskHistory.json`) in the same store.
 */
export async function scanVscodeTasks(
	config: VscodeTaskRoot,
): Promise<ConversationMeta[]> {
	const tasksDir = resolve(config.root, "tasks");
	const taskIds = await readdir(tasksDir).catch(() => null);
	if (!taskIds) return [];

	const taskHistoryIndex =
		config.history === "task-history"
			? await loadTaskHistoryIndex(config.root)
			: null;

	const metas: ConversationMeta[] = [];
	for (const taskId of taskIds.sort()) {
		const taskDir = resolve(tasksDir, taskId);
		const historyPath = resolve(taskDir, "api_conversation_history.json");
		const historyStat = await stat(historyPath).catch(() => null);
		if (!historyStat?.isFile()) continue;

		const times = { size: historyStat.size, mtime: historyStat.mtime };
		if (config.history === "per-task") {
			await mergeCompanionFile(times, resolve(taskDir, "history_item.json"));
		}
		const history =
			config.history === "per-task"
				? await readTaskHistoryItem(taskDir)
				: (taskHistoryIndex?.get(taskId) ?? null);
		const workspace = history?.workspace ?? "";
		metas.push({
			id: taskId,
			source: config.source,
			filePath: historyPath,
			fileSize: times.size,
			fileMtime: times.mtime.toISOString(),
			projectDir: workspace ? decodeFileUri(workspace) : "",
			rootDir: config.root,
		});
	}
	return metas;
}

// =============================================
// Parsing
// =============================================

/**
 * Parse one task transcript into a ChatCrystal conversation.
 *
 * Message order follows the transcript array. Timestamps are synthesized from
 * the task's history `ts` (epoch ms), falling back to the transcript file
 * mtime when no history metadata exists: message N is `base + N seconds`.
 */
export async function parseVscodeTask(
	meta: ConversationMeta,
	config: VscodeTaskRoot,
): Promise<ParsedConversation> {
	const taskDir = dirname(meta.filePath);
	const taskId = basename(taskDir);
	// A WSL-backed task carries the store root it came from; its
	// `state/taskHistory.json` lives there, not under the primary (Windows) root.
	const storeConfig: VscodeTaskRoot = meta.rootDir
		? { ...config, root: meta.rootDir }
		: config;
	const history = await loadTaskHistory(storeConfig, taskId, taskDir);

	const raw = await readJsonFile(meta.filePath);
	const entries = asArrayField(raw, ["messages"]);
	const baseMs =
		history?.ts ?? toEpochMs(meta.fileMtime) ?? new Date().getTime();

	const messages: ParsedMessage[] = [];
	let firstUserText: string | null = null;

	for (const entry of entries) {
		const record = toRecord(entry);
		if (!record) continue; // Skip corrupt entries, keep the rest of the task.
		const role = record.role;
		if (role !== "user" && role !== "assistant") continue;

		const extraction = extractContentText(record.content);
		const content =
			role === "user" ? unwrapTaskEnvelope(extraction.text) : extraction.text;
		if (!content && extraction.thinking === null && !extraction.hasToolUse) {
			continue;
		}
		if (role === "user" && firstUserText === null && content) {
			firstUserText = content;
		}

		messages.push({
			id: `${taskId}-${messages.length}`,
			parentUuid: null,
			type: role,
			role,
			content,
			hasToolUse: extraction.hasToolUse,
			hasCode: extraction.hasCode,
			thinking: extraction.thinking,
			timestamp: new Date(baseMs + messages.length * 1000).toISOString(),
		});
	}

	const historyTask = history?.task ? unwrapTaskEnvelope(history.task) : "";
	const workspace = history?.workspace ?? "";
	const projectDir =
		meta.projectDir || (workspace ? decodeFileUri(workspace) : "");
	const fallbackIso = new Date(baseMs).toISOString();

	return {
		id: meta.id,
		slug: truncateSlug(historyTask || firstUserText || ""),
		source: config.source,
		projectDir,
		projectName: projectNameFromDir(projectDir),
		cwd: projectDir || null,
		gitBranch: null,
		messages,
		firstMessageAt: messages[0]?.timestamp ?? fallbackIso,
		lastMessageAt: messages[messages.length - 1]?.timestamp ?? fallbackIso,
	};
}

// =============================================
// Watching
// =============================================

/**
 * Chokidar targets for one extension task store. Only globs whose static
 * parent directory exists are returned so the watcher never watches a
 * non-existent path.
 */
export function vscodeTaskWatchPaths(config: VscodeTaskRoot): string[] {
	const paths: string[] = [];
	const tasksDir = resolve(config.root, "tasks");
	if (existsSync(tasksDir)) {
		paths.push(resolve(tasksDir, "**", "api_conversation_history.json"));
		if (config.history === "per-task") {
			paths.push(resolve(tasksDir, "**", "history_item.json"));
		}
	}
	if (config.history === "task-history") {
		const indexPath = resolve(config.root, "state", "taskHistory.json");
		if (existsSync(indexPath)) paths.push(indexPath);
	}
	return paths;
}
