/**
 * Gemini CLI adapter.
 *
 * The Gemini CLI keeps chats under `<dataDir>/tmp/<project-id>/chats/`, where
 * `<project-id>` is a short slug from the project registry (`projects.json`,
 * `{ "projects": { "<absolute cwd>": "<short id>" } }`), and stores sessions in
 * two generations side by side:
 *  - a whole-session `.json` snapshot
 *    (`{ sessionId, startTime, lastUpdated, messages: [...] }`), and
 *  - an append-only `.jsonl` log whose first line is session metadata, followed
 *    by message records and replay records (`$set`, `$rewindTo`, `$patch`).
 *
 * Messages are `{ id, timestamp, type, content, toolCalls?, thoughts? }` where
 * `type: "user"` is a prompt and `type: "gemini" | "model"` is a reply; other
 * types (info/error/warning/system) are CLI events, not conversation turns.
 * Tool results are not written into the message body; a message with tool calls
 * is only flagged as tool-using.
 *
 * When the same session exists as both `.json` and `.jsonl`, only the newest
 * file is imported: the legacy snapshot is atomically rewritten while the
 * append-only log keeps growing, so the most recently modified file is the
 * store Gemini last wrote.
 */

import { createReadStream, existsSync } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";
import type {
	ConversationMeta,
	ParsedConversation,
	ParsedMessage,
	SourceInfo,
} from "@chatcrystal/shared";
import { appConfig } from "../../config.js";
import type { SourceAdapter } from "../adapter.js";
import { withWslRoots } from "../sourceRoots.js";

const SOURCE_NAME = "gemini";
const DISPLAY_NAME = "Gemini CLI";
const PARSER_VERSION = "gemini@2";

/** Main session files; nested subagent chats live in subdirectories and are skipped. */
const SESSION_FILE_PATTERN = /^session-.*\.(?:json|jsonl)$/i;

/** How much of a session file is read to recover its id without parsing the body. */
const HEAD_BYTES = 16 * 1024;

/** `info`, `error` and `warning` records are CLI notices, not conversation turns. */
const SKIPPED_TYPES = new Set(["info", "error", "warning", "system"]);

// =============================================
// Raw Gemini session types
// =============================================

interface GeminiPart {
	text?: string;
	thought?: boolean;
	functionCall?: { name?: string };
	functionResponse?: unknown;
	inlineData?: unknown;
}

type GeminiContent =
	| string
	| GeminiPart[]
	| { parts?: GeminiPart[] }
	| null
	| undefined;

interface GeminiToolCall {
	id?: string;
	name?: string;
	status?: string;
	timestamp?: string;
}

interface GeminiMessageRecord {
	id?: string;
	timestamp?: string;
	type?: string;
	content?: GeminiContent;
	displayContent?: GeminiContent;
	toolCalls?: GeminiToolCall[];
	thoughts?: Array<{
		subject?: string;
		description?: string;
		timestamp?: string;
	}>;
}

interface GeminiSessionMetadata {
	sessionId?: string;
	projectHash?: string;
	startTime?: string;
	lastUpdated?: string;
	kind?: string;
	messages?: GeminiMessageRecord[];
}

/** One line of a replayable `.jsonl` session log. */
interface GeminiJsonlRecord extends GeminiMessageRecord, GeminiSessionMetadata {
	$set?: GeminiSessionMetadata;
	$rewindTo?: string;
	$patch?: {
		id?: string;
		content?: GeminiContent;
		updates?: GeminiMessageRecord[];
		removeIds?: string[];
		orderIds?: string[];
	};
}

interface SessionHead {
	sessionId: string | null;
	startTime: string | null;
}

interface SessionFileCandidate {
	filePath: string;
	sessionId: string;
	projectCwd: string;
	fileSize: number;
	mtimeMs: number;
	rootDir: string;
}

interface ExtractedContent {
	text: string;
	thinking: string | null;
	hasToolUse: boolean;
	toolResultOnly: boolean;
}

// =============================================
// Small value helpers
// =============================================

function isPathLike(value: string): boolean {
	return (
		/^[A-Za-z]:[\\/]/.test(value) ||
		value.startsWith("/") ||
		value.startsWith("\\\\") ||
		value.startsWith("~")
	);
}

/**
 * Normalize the timestamp shapes Gemini has used (RFC 3339 strings, epoch
 * milliseconds and occasionally epoch seconds) to an ISO string.
 */
function normalizeTimestamp(value: unknown, fallback: string): string {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		// Epoch seconds are ~1e9-1e10; epoch milliseconds are ~1e12.
		const millis = value < 1e11 ? value * 1000 : value;
		const date = new Date(millis);
		return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
	}
	if (typeof value === "string" && value.trim()) {
		const trimmed = value.trim();
		const numeric = Number(trimmed);
		if (Number.isFinite(numeric) && numeric > 0) {
			return normalizeTimestamp(numeric, fallback);
		}
		const parsed = Date.parse(trimmed);
		if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
	}
	return fallback;
}

/** Fallback timestamp used when a record has no usable timestamp. */
async function fileMtimeIso(filePath: string): Promise<string> {
	try {
		const fileStat = await stat(filePath);
		return fileStat.mtime.toISOString();
	} catch {
		return new Date(0).toISOString();
	}
}

function projectNameFromCwd(cwd: string | null): string {
	if (!cwd) return "Gemini";
	const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? "Gemini";
}

// =============================================
// Project registry (`projects.json`)
// =============================================

function collectProjectMappings(
	value: unknown,
	into: Map<string, string>,
): void {
	if (!value || typeof value !== "object" || Array.isArray(value)) return;
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (typeof entry === "string") {
			// Canonical registry shape: absolute project path -> short id. A
			// handful of forks and older builds wrote the pair the other way
			// around, so accept either direction.
			if (isPathLike(key) && !isPathLike(entry)) {
				into.set(entry, key);
			} else if (isPathLike(entry) && !isPathLike(key)) {
				into.set(key, entry);
			}
			continue;
		}
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
		const record = entry as Record<string, unknown>;
		const path = [record.cwd, record.path, record.root, record.projectRoot]
			.map((item) => (typeof item === "string" ? item : ""))
			.find((item) => item.length > 0);
		const id = [record.id, record.projectId, record.project_id]
			.map((item) => (typeof item === "string" ? item : ""))
			.find((item) => item.length > 0);
		if (path && id) into.set(id, path);
		else if (path && !isPathLike(key)) into.set(key, path);
	}
}

/** Map `project id -> absolute cwd`, read from the shared project registry. */
async function loadProjectRegistry(
	root: string,
): Promise<Map<string, string>> {
	const mappings = new Map<string, string>();
	const candidates = [
		resolve(root, "projects.json"),
		resolve(root, "config", "projects.json"),
	];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		try {
			const parsed = JSON.parse(await readFile(candidate, "utf-8")) as {
				projects?: unknown;
			};
			const projects =
				parsed && typeof parsed === "object" ? parsed.projects : undefined;
			collectProjectMappings(projects, mappings);
		} catch {
			// A corrupt registry only costs the project name; keep scanning.
		}
	}
	return mappings;
}

/**
 * Resolve the working directory a project id refers to. The per-project
 * `.project_root` marker is authoritative when present; the registry mapping
 * is the fallback.
 */
async function resolveProjectCwd(
	root: string,
	projectId: string,
	registry: Map<string, string>,
): Promise<string> {
	try {
		const marker = await readFile(
			resolve(root, "tmp", projectId, ".project_root"),
			"utf-8",
		);
		const value = marker.trim();
		if (value && isPathLike(value)) return value;
	} catch {
		// No ownership marker for this project.
	}
	return registry.get(projectId) ?? "";
}

// =============================================
// Content extraction
// =============================================

function visitContent(
	content: GeminiContent,
	visit: (part: GeminiPart | string) => void,
): void {
	if (content === null || content === undefined) return;
	if (typeof content === "string") {
		visit(content);
		return;
	}
	if (Array.isArray(content)) {
		for (const part of content) visit(part);
		return;
	}
	if (typeof content === "object" && Array.isArray(content.parts)) {
		for (const part of content.parts) visit(part);
	}
}

function extractContent(record: GeminiMessageRecord): ExtractedContent {
	const texts: string[] = [];
	const thinkingParts: string[] = [];
	let hasToolUse = false;
	let hasFunctionResponse = false;
	let hasTypedText = false;

	const visitPart = (part: GeminiPart | string): void => {
		if (typeof part === "string") {
			if (part.trim()) {
				texts.push(part);
				hasTypedText = true;
			}
			return;
		}
		if (!part || typeof part !== "object") return;
		if (typeof part.text === "string" && part.text.trim()) {
			if (part.thought) {
				thinkingParts.push(part.text);
			} else {
				texts.push(part.text);
				hasTypedText = true;
			}
		}
		if (part.functionCall) hasToolUse = true;
		if (part.functionResponse) hasFunctionResponse = true;
	};

	visitContent(record.content, visitPart);

	if ((record.toolCalls?.length ?? 0) > 0) hasToolUse = true;

	// Replies may record their reasoning separately from the content parts.
	for (const thought of record.thoughts ?? []) {
		const subject = thought.subject?.trim() ?? "";
		const description = thought.description?.trim() ?? "";
		if (!subject && !description) continue;
		thinkingParts.push(
			subject && description ? `${subject}: ${description}` : subject || description,
		);
	}

	return {
		text: texts.join("\n").trim(),
		thinking: thinkingParts.length > 0 ? thinkingParts.join("\n") : null,
		hasToolUse,
		// A user record that only carries functionResponse parts is Gemini's
		// tool-result turn, not something the person typed.
		toolResultOnly: hasFunctionResponse && !hasTypedText && !hasToolUse,
	};
}

function toParsedMessage(
	record: GeminiMessageRecord,
	conversationId: string,
	index: number,
	fallbackTimestamp: string,
): ParsedMessage | null {
	if (!record || typeof record !== "object") return null;
	const rawType = (record.type ?? "").toLowerCase();
	if (SKIPPED_TYPES.has(rawType)) return null;

	let type: "user" | "assistant" | null = null;
	if (rawType === "user") type = "user";
	else if (rawType === "gemini" || rawType === "model") type = "assistant";
	if (!type) return null;

	const { text, thinking, hasToolUse, toolResultOnly } = extractContent(record);
	if (type === "user" && toolResultOnly) return null;

	const content = text.trim();
	if (!content && !thinking && !hasToolUse) return null;

	return {
		id: record.id?.trim() || `${conversationId}-${index}`,
		parentUuid: null,
		type,
		role: type,
		content,
		hasToolUse,
		hasCode: content.includes("```"),
		thinking,
		timestamp: normalizeTimestamp(record.timestamp, fallbackTimestamp),
	};
}

// =============================================
// Session discovery
// =============================================

/** Read the session id from the first bytes of a session file. */
async function readSessionHead(filePath: string): Promise<SessionHead> {
	let handle: FileHandle;
	try {
		handle = await open(filePath, "r");
	} catch {
		return { sessionId: null, startTime: null };
	}
	try {
		const buffer = Buffer.alloc(HEAD_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const head = buffer
			.subarray(0, bytesRead)
			.toString("utf-8")
			.replace(/^\uFEFF/, "");

		// Whole-session snapshots carry sessionId in their opening bytes, and the
		// JSONL metadata line (also first) matches the same pattern.
		const sessionIdMatch = /"sessionId"\s*:\s*"([^"]+)"/.exec(head);
		if (sessionIdMatch?.[1]) {
			const startMatch = /"startTime"\s*:\s*"([^"]+)"/.exec(head);
			return {
				sessionId: sessionIdMatch[1],
				startTime: startMatch?.[1] ?? null,
			};
		}

		// Pretty-printed snapshots put metadata on its own line; fall back to
		// parsing the first complete JSON line.
		const firstLine = head
			.split(/\r?\n/)
			.find((line) => line.trim().length > 0);
		if (firstLine) {
			try {
				const parsed = JSON.parse(firstLine) as GeminiSessionMetadata;
				if (typeof parsed.sessionId === "string" && parsed.sessionId) {
					return {
						sessionId: parsed.sessionId,
						startTime:
							typeof parsed.startTime === "string" ? parsed.startTime : null,
					};
				}
			} catch {
				// Partial or corrupt line; the file name is the fallback id.
			}
		}
		return { sessionId: null, startTime: null };
	} finally {
		await handle.close();
	}
}

/**
 * Gemini CLI home folders to scan: the local install plus every running WSL
 * distro home that has a `.gemini` folder.
 */
function geminiRoots(): string[] {
	return withWslRoots(appConfig.geminiDataDir, ".gemini");
}

/** Session files below one Gemini home (`<root>/tmp/<project>/chats/`). */
async function collectRootSessionFiles(
	root: string,
): Promise<SessionFileCandidate[]> {
	const tmpDir = resolve(root, "tmp");
	if (!existsSync(tmpDir)) return [];

	const registry = await loadProjectRegistry(root);
	const candidates: SessionFileCandidate[] = [];

	let projectEntries: Dirent[];
	try {
		projectEntries = await readdir(tmpDir, { withFileTypes: true });
	} catch {
		return [];
	}

	for (const projectEntry of projectEntries) {
		if (!projectEntry.isDirectory()) continue;
		const projectId = projectEntry.name;
		const chatsDir = resolve(tmpDir, projectId, "chats");
		if (!existsSync(chatsDir)) continue;

		const projectCwd = await resolveProjectCwd(root, projectId, registry);

		let chatEntries: Dirent[];
		try {
			chatEntries = await readdir(chatsDir, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const chatEntry of chatEntries) {
			// Subagent runs are nested below the parent chats directory; only
			// top-level session files are main conversations.
			if (!chatEntry.isFile() || !SESSION_FILE_PATTERN.test(chatEntry.name)) {
				continue;
			}
			const filePath = resolve(chatsDir, chatEntry.name);
			let fileStat: Stats;
			try {
				fileStat = await stat(filePath);
			} catch {
				continue;
			}
			// Empty files are placeholders written before the first message.
			if (fileStat.size < 2) continue;

			const head = await readSessionHead(filePath);
			const fallbackId = basename(chatEntry.name).replace(
				/\.(?:json|jsonl)$/i,
				"",
			);
			candidates.push({
				filePath,
				sessionId: head.sessionId ?? fallbackId,
				projectCwd,
				fileSize: fileStat.size,
				mtimeMs: fileStat.mtimeMs,
				rootDir: root,
			});
		}
	}

	return candidates;
}

async function collectSessionFiles(): Promise<SessionFileCandidate[]> {
	const candidates: SessionFileCandidate[] = [];
	for (const root of geminiRoots()) {
		try {
			candidates.push(...(await collectRootSessionFiles(root)));
		} catch {
			// A WSL distro can stop while reading; keep the other roots' sessions.
		}
	}
	return candidates;
}

/**
 * A legacy `.json` snapshot and an append-only `.jsonl` log can describe the
 * same session. Import only one: the newest file wins, because Gemini
 * atomically rewrites snapshots and appends to logs, so the newest mtime is
 * the generation it last wrote.
 */
function dedupeSessionFiles(
	candidates: SessionFileCandidate[],
): SessionFileCandidate[] {
	const bySession = new Map<string, SessionFileCandidate>();
	for (const candidate of candidates) {
		const existing = bySession.get(candidate.sessionId);
		if (!existing || candidate.mtimeMs > existing.mtimeMs) {
			bySession.set(candidate.sessionId, candidate);
		}
	}
	return [...bySession.values()];
}

function toConversationMeta(candidate: SessionFileCandidate): ConversationMeta {
	return {
		id: candidate.sessionId,
		source: SOURCE_NAME,
		filePath: candidate.filePath,
		fileSize: candidate.fileSize,
		fileMtime: new Date(candidate.mtimeMs).toISOString(),
		projectDir: candidate.projectCwd,
		rootDir: candidate.rootDir,
	};
}

// =============================================
// JSONL replay
// =============================================

interface ReplayedSession {
	metadata: GeminiSessionMetadata;
	records: GeminiMessageRecord[];
}

/**
 * Replay a `.jsonl` session log. The log is append-only, so rewinds remove the
 * referenced turn and everything after it, `$patch` updates an existing
 * record, and `$set` replaces the session metadata (a legacy full-history
 * checkpoint may arrive the same way).
 */
async function replayJsonl(filePath: string): Promise<ReplayedSession> {
	const metadata: GeminiSessionMetadata = {};
	const records: GeminiMessageRecord[] = [];
	const indexById = new Map<string, number>();

	const rebuildIndex = (): void => {
		indexById.clear();
		records.forEach((record, position) => {
			if (typeof record.id === "string" && record.id) {
				indexById.set(record.id, position);
			}
		});
	};

	const upsertRecord = (record: GeminiMessageRecord): void => {
		const id = typeof record.id === "string" ? record.id : "";
		if (!id) return;
		const existing = indexById.get(id);
		if (existing === undefined) {
			indexById.set(id, records.length);
			records.push(record);
		} else {
			records[existing] = record;
		}
	};

	const rewindTo = (id: string): void => {
		const position = indexById.get(id);
		if (position === undefined) {
			// The rewind target is missing (trimmed log); nothing can be kept
			// reliably after the point it refers to.
			records.length = 0;
			indexById.clear();
			return;
		}
		records.splice(position);
		rebuildIndex();
	};

	const removeIds = (ids: string[]): void => {
		const removed = new Set(ids);
		const kept = records.filter(
			(record) => !(typeof record.id === "string" && removed.has(record.id)),
		);
		records.length = 0;
		records.push(...kept);
		rebuildIndex();
	};

	const applyPatch = (patch: NonNullable<GeminiJsonlRecord["$patch"]>): void => {
		if (typeof patch.id === "string") {
			const position = indexById.get(patch.id);
			if (position !== undefined) {
				const updated: GeminiMessageRecord = { ...records[position] };
				if (patch.content !== undefined) updated.content = patch.content;
				records[position] = updated;
			}
		}
		for (const update of patch.updates ?? []) {
			if (typeof update.id !== "string") continue;
			const position = indexById.get(update.id);
			if (position === undefined) continue;
			const merged: GeminiMessageRecord = { ...records[position] };
			if (update.content !== undefined) merged.content = update.content;
			records[position] = merged;
		}
		if (Array.isArray(patch.removeIds)) removeIds(patch.removeIds);
		if (Array.isArray(patch.orderIds)) {
			const ordered: GeminiMessageRecord[] = [];
			const seen = new Set<string>();
			for (const id of patch.orderIds) {
				if (typeof id !== "string") continue;
				const position = indexById.get(id);
				if (position === undefined) continue;
				ordered.push(records[position]);
				seen.add(id);
			}
			for (const record of records) {
				if (typeof record.id === "string" && seen.has(record.id)) continue;
				ordered.push(record);
			}
			records.length = 0;
			records.push(...ordered);
			rebuildIndex();
		}
	};

	const readline = createInterface({
		input: createReadStream(filePath, { encoding: "utf-8" }),
		crlfDelay: Number.POSITIVE_INFINITY,
	});

	for await (const line of readline) {
		if (!line.trim()) continue;
		let record: GeminiJsonlRecord;
		try {
			record = JSON.parse(line) as GeminiJsonlRecord;
		} catch {
			continue; // A partially flushed line: keep the rest of the log.
		}
		if (!record || typeof record !== "object") continue;

		if (typeof record.$rewindTo === "string") {
			rewindTo(record.$rewindTo);
			continue;
		}
		if (record.$set && typeof record.$set === "object") {
			const set = record.$set;
			if (typeof set.sessionId === "string") metadata.sessionId = set.sessionId;
			if (typeof set.startTime === "string") metadata.startTime = set.startTime;
			if (typeof set.lastUpdated === "string") {
				metadata.lastUpdated = set.lastUpdated;
			}
			if (Array.isArray(set.messages)) {
				records.length = 0;
				indexById.clear();
				for (const message of set.messages) upsertRecord(message);
			}
			continue;
		}
		if (record.$patch && typeof record.$patch === "object") {
			applyPatch(record.$patch);
			continue;
		}

		if (
			typeof record.sessionId === "string" &&
			typeof record.id !== "string"
		) {
			// Session metadata line.
			metadata.sessionId = metadata.sessionId ?? record.sessionId;
			if (typeof record.startTime === "string" && !metadata.startTime) {
				metadata.startTime = record.startTime;
			}
			if (typeof record.lastUpdated === "string") {
				metadata.lastUpdated = record.lastUpdated;
			}
			continue;
		}

		if (typeof record.id === "string" && typeof record.type === "string") {
			upsertRecord(record);
		}
	}

	return { metadata, records };
}

// =============================================
// Conversation assembly
// =============================================

function projectNameOrPlaceholder(cwd: string | null): string {
	return cwd ? projectNameFromCwd(cwd) : "Gemini";
}

function assembleConversation(
	meta: ConversationMeta,
	messages: ParsedMessage[],
	startTimestamp: string,
	lastTimestamp: string,
): ParsedConversation {
	const cwd = meta.projectDir || null;
	return {
		id: meta.id,
		slug: null,
		source: SOURCE_NAME,
		projectDir: cwd ?? "",
		projectName: projectNameOrPlaceholder(cwd),
		cwd,
		gitBranch: null,
		messages,
		firstMessageAt: messages[0]?.timestamp ?? startTimestamp,
		lastMessageAt: messages[messages.length - 1]?.timestamp ?? lastTimestamp,
	};
}

function toParsedMessages(
	records: GeminiMessageRecord[],
	conversationId: string,
	fallbackTimestamp: string,
): ParsedMessage[] {
	const messages: ParsedMessage[] = [];
	records.forEach((record, index) => {
		const message = toParsedMessage(
			record,
			conversationId,
			index,
			fallbackTimestamp,
		);
		if (message) messages.push(message);
	});
	return messages;
}

// =============================================
// Gemini Adapter
// =============================================

export const geminiAdapter: SourceAdapter = {
	name: SOURCE_NAME,
	displayName: DISPLAY_NAME,
	parserVersion: PARSER_VERSION,

	async detect(): Promise<SourceInfo | null> {
		try {
			const sessions = dedupeSessionFiles(await collectSessionFiles());
			if (sessions.length === 0) return null;
			return {
				name: SOURCE_NAME,
				displayName: DISPLAY_NAME,
				dataDir: appConfig.geminiDataDir,
				conversationCount: sessions.length,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		try {
			const sessions = dedupeSessionFiles(await collectSessionFiles());
			return sessions.map(toConversationMeta);
		} catch {
			return [];
		}
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		const fallbackTimestamp = await fileMtimeIso(meta.filePath);

		try {
			if (meta.filePath.toLowerCase().endsWith(".jsonl")) {
				const { metadata, records } = await replayJsonl(meta.filePath);
				const startTimestamp = normalizeTimestamp(
					metadata.startTime,
					fallbackTimestamp,
				);
				const messages = toParsedMessages(
					records,
					meta.id,
					startTimestamp,
				);
				const lastTimestamp = normalizeTimestamp(
					metadata.lastUpdated,
					messages[messages.length - 1]?.timestamp ?? startTimestamp,
				);
				return assembleConversation(meta, messages, startTimestamp, lastTimestamp);
			}

			const snapshot = JSON.parse(
				await readFile(meta.filePath, "utf-8"),
			) as GeminiSessionMetadata;
			const startTimestamp = normalizeTimestamp(
				snapshot.startTime,
				fallbackTimestamp,
			);
			const records = Array.isArray(snapshot.messages) ? snapshot.messages : [];
			const messages = toParsedMessages(records, meta.id, startTimestamp);
			const lastTimestamp = normalizeTimestamp(
				snapshot.lastUpdated,
				messages[messages.length - 1]?.timestamp ?? startTimestamp,
			);
			return assembleConversation(meta, messages, startTimestamp, lastTimestamp);
		} catch (err) {
			// Corrupt or still-being-written file: import an empty conversation
			// rather than failing the whole import batch.
			console.warn(
				`[Gemini] Failed to parse ${meta.filePath}:`,
				err instanceof Error ? err.message : err,
			);
			return assembleConversation(meta, [], fallbackTimestamp, fallbackTimestamp);
		}
	},

	watchPaths(): string[] {
		// Only the local root is watched: chokidar cannot watch UNC paths, and
		// touching a stopped WSL distro would start it. WSL sessions are picked
		// up by the next manual Import.
		const root = appConfig.geminiDataDir;
		if (!existsSync(root)) return [];
		return [resolve(root, "tmp", "**", "chats", "*")];
	},
};
