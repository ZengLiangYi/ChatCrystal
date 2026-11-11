/**
 * MiniMax Code adapter.
 *
 * MiniMax Code keeps each session in a folder of its own, dated down to the
 * millisecond, with the session id base64-encoded in the folder name:
 *
 *   <minimaxDataDir>/v2/sessions/<yyyy>/<mm>/<dd>/
 *     <hh-mm-ss-ms>-session_<base64 session id>/
 *       messages.jsonl        — the session's messages, one a line
 *       messages*.jsonl       — older generations the history catalog keeps
 *
 * A line is `{ message_id, turn_id, message }`, where `message.role` is
 * "user", "assistant" (or "toolResult" / "custom", skipped here) and
 * `message.content` an array of parts: `{ type: "text", text }`,
 * `{ type: "thinking", thinking }` and `{ type: "toolCall", name, arguments }`
 * for an assistant's reply. `message.timestamp` is epoch milliseconds.
 *
 * A user message may carry the text the person actually typed in
 * `genuineUserQueryText` or as a `canonicalTextRange` (start/end offsets) into
 * `content`; the rest of the content is the app's injected context
 * (`<system-reminder>` blocks). When neither is present the injected blocks are
 * stripped here.
 *
 * Older generations (`messages*.jsonl`) repeat the replies the active
 * `messages.jsonl` still has (same `message_id`) and keep the turns the active
 * one no longer does, so all of them are read and de-duplicated by message id.
 *
 * The session folders carry no title and no cwd (Magpie only reads their usage
 * lines), so a conversation's name falls back to its first prompt and its
 * project dir stays empty.
 *
 * A WSL distro home is scanned too: `<distro-home>/.minimax`.
 */

import { existsSync, type Dirent, type Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type {
	ConversationMeta,
	ParsedConversation,
	ParsedMessage,
	SourceInfo,
} from "@chatcrystal/shared";
import { appConfig } from "../../config.js";
import type { SourceAdapter } from "../adapter.js";
import { withWslRoots } from "../sourceRoots.js";

const SOURCE = "minimax-code";
const DISPLAY_NAME = "MiniMax Code";
const SESSIONS_PATH = ["v2", "sessions"] as const;
/** Distro-home-relative location of MiniMax Code's data folder. */
const WSL_RELATIVE = ".minimax";
/** How deep below `v2/sessions` a session folder may sit (y/m/d is three). */
const MAX_WALK_DEPTH = 8;

// =============================================
// Raw message shapes
// =============================================

interface MinimaxContentPart {
	type?: unknown;
	text?: unknown;
	thinking?: unknown;
}

interface MinimaxRawMessage {
	role?: unknown;
	content?: unknown;
	timestamp?: unknown;
	genuineUserQueryText?: unknown;
	canonicalTextRange?: unknown;
}

interface MinimaxLine {
	message_id?: unknown;
	message?: MinimaxRawMessage;
}

// =============================================
// Paths
// =============================================

function getDataDir(): string {
	return appConfig.minimaxDataDir;
}

/** The Windows-local install plus every WSL distro home with `.minimax`. */
function minimaxRoots(): string[] {
	return withWslRoots(getDataDir(), WSL_RELATIVE);
}

function sessionsDirFor(root: string): string {
	return resolve(root, ...SESSIONS_PATH);
}

// =============================================
// Session discovery
// =============================================

/** A session folder's message files, its active one, and their combined stat. */
interface MinimaxSessionStore {
	dir: string;
	activeFile: string;
	fileSize: number;
	fileMtime: Date;
}

/** `messages.jsonl` and any older generation beside it (`messages*.jsonl`). */
function isMessageFile(name: string): boolean {
	return name.startsWith("messages") && name.endsWith(".jsonl");
}

/** `messages.jsonl` wins; without it the newest generation is the active one. */
function pickActiveFile(files: string[], stats: (Stats | null)[]): string {
	const preferred = files.find((file) => basename(file) === "messages.jsonl");
	if (preferred) return preferred;

	let best = files[0] ?? "";
	let bestTime = Number.NEGATIVE_INFINITY;
	for (let index = 0; index < files.length; index += 1) {
		const fileStat = stats[index];
		const mtime = fileStat?.isFile() ? fileStat.mtime.getTime() : 0;
		const file = files[index] ?? "";
		if (mtime > bestTime || (mtime === bestTime && file > best)) {
			best = file;
			bestTime = mtime;
		}
	}
	return best;
}

async function findSessionStores(root: string): Promise<MinimaxSessionStore[]> {
	const stores: MinimaxSessionStore[] = [];

	async function walk(dir: string, depth: number): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}

		const files: string[] = [];
		const subdirs: string[] = [];
		for (const entry of entries) {
			const fullPath = resolve(dir, entry.name);
			if (entry.isFile() && isMessageFile(entry.name)) {
				files.push(fullPath);
			} else if (entry.isDirectory() && depth < MAX_WALK_DEPTH) {
				subdirs.push(fullPath);
			}
		}

		if (files.length > 0) {
			files.sort();
			const stats = await Promise.all(
				files.map((file) => stat(file).catch(() => null)),
			);
			let fileSize = 0;
			let fileMtime = new Date(0);
			for (const fileStat of stats) {
				if (!fileStat?.isFile()) continue;
				fileSize += fileStat.size;
				if (fileStat.mtime > fileMtime) fileMtime = fileStat.mtime;
			}
			stores.push({
				dir,
				activeFile: pickActiveFile(files, stats),
				fileSize,
				fileMtime,
			});
			// A session folder holds only its own generations; do not descend
			// into tool-output or attachment subfolders.
			return;
		}

		for (const subdir of subdirs) await walk(subdir, depth + 1);
	}

	await walk(sessionsDirFor(root), 0);
	return stores;
}

// =============================================
// Session id / base64
// =============================================

function tryDecodeBase64(encoded: string, base64url: boolean): string | null {
	const pattern = base64url
		? /^[A-Za-z0-9_-]+={0,2}$/
		: /^[A-Za-z0-9+/]+={0,2}$/;
	if (!pattern.test(encoded)) return null;

	const normalized = base64url
		? encoded.replace(/-/g, "+").replace(/_/g, "/")
		: encoded;
	try {
		const buffer = Buffer.from(normalized, "base64");
		if (buffer.length === 0) return null;
		// Node's decoder is lenient; a round trip rejects a partial decode.
		if (
			buffer.toString("base64").replace(/=+$/, "") !==
			normalized.replace(/=+$/, "")
		) {
			return null;
		}
		return buffer.toString("utf8");
	} catch {
		return null;
	}
}

/**
 * A session folder's id: the base64 after `-session_` (MiniMax decoded it to a
 * `mvs_…` id), or the folder's name when it has no such part.
 */
function minimaxSessionId(dirName: string): string {
	const marker = "-session_";
	const at = dirName.indexOf(marker);
	if (at < 0) return dirName;
	const encoded = dirName.slice(at + marker.length);
	if (!encoded) return dirName;
	const decoded =
		tryDecodeBase64(encoded, true) ?? tryDecodeBase64(encoded, false);
	return decoded || encoded;
}

// =============================================
// Content helpers
// =============================================

const SYSTEM_REMINDER_PATTERN =
	/<system-reminder(?:\s[^>]*)?>[\s\S]*?<\/system-reminder>/g;
const ATTACHMENT_PATTERN = /<attachment\b[^>]*>[\s\S]*?<\/attachment>/g;
const USER_QUERY_PATTERN = /<user_query>([\s\S]*?)<\/user_query>/g;

function stringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function joinedContentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const texts: string[] = [];
	for (const item of content) {
		if (!item || typeof item !== "object") continue;
		const part = item as MinimaxContentPart;
		if (part.type === "text" && typeof part.text === "string") {
			texts.push(part.text);
		}
	}
	return texts.join("\n");
}

/**
 * The words a person typed into a user message. MiniMax Code wraps them in
 * injected context; the app records where the genuine text is in
 * `genuineUserQueryText` / `canonicalTextRange`. When that is missing the
 * injected blocks and envelopes are stripped.
 */
function extractUserText(raw: MinimaxRawMessage): string {
	const genuine = stringField(raw.genuineUserQueryText);
	if (genuine) return genuine;

	const text = joinedContentText(raw.content);
	const range = raw.canonicalTextRange;
	if (range && typeof range === "object" && !Array.isArray(range)) {
		const { startOffset, endOffset } = range as {
			startOffset?: unknown;
			endOffset?: unknown;
		};
		if (
			typeof startOffset === "number" &&
			typeof endOffset === "number" &&
			startOffset >= 0 &&
			endOffset > startOffset &&
			endOffset <= text.length
		) {
			const sliced = text.slice(startOffset, endOffset).trim();
			if (sliced) return sliced;
		}
	}

	const queries: string[] = [];
	for (const match of text.matchAll(USER_QUERY_PATTERN)) {
		const query = (match[1] ?? "").trim();
		if (query) queries.push(query);
	}
	if (queries.length > 0) return queries.join("\n");

	return text
		.replace(SYSTEM_REMINDER_PATTERN, "")
		.replace(ATTACHMENT_PATTERN, "")
		.trim();
}

interface MinimaxExtraction {
	text: string;
	thinking: string | null;
	hasToolUse: boolean;
}

function extractAssistantContent(content: unknown): MinimaxExtraction {
	if (typeof content === "string") {
		const text = content.trim();
		return { text, thinking: null, hasToolUse: false };
	}

	const texts: string[] = [];
	const thinking: string[] = [];
	let hasToolUse = false;

	if (Array.isArray(content)) {
		for (const item of content) {
			if (!item || typeof item !== "object") continue;
			const part = item as MinimaxContentPart;
			const type = typeof part.type === "string" ? part.type : "";
			if (type === "text" && typeof part.text === "string") {
				texts.push(part.text);
			} else if (type === "thinking" || type === "reasoning") {
				if (typeof part.thinking === "string") thinking.push(part.thinking);
				else if (typeof part.text === "string") thinking.push(part.text);
			} else if (
				type === "toolCall" ||
				type === "tool_call" ||
				type === "tool_use"
			) {
				hasToolUse = true;
			}
		}
	}

	return {
		text: texts.join("\n").trim(),
		thinking: thinking.length > 0 ? thinking.join("\n").trim() : null,
		hasToolUse,
	};
}

function timestampMs(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return value > 1e11 ? value : value * 1000;
	}
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		return Number.isNaN(parsed) ? null : parsed;
	}
	return null;
}

function extractProjectName(projectDir: string): string {
	const normalized = projectDir.replace(/\\/g, "/").replace(/\/+$/, "");
	const segments = normalized.split("/").filter(Boolean);
	return segments[segments.length - 1] ?? "";
}

function truncateSlug(text: string, maxLength = 80): string | null {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return null;
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, Math.max(1, maxLength - 3))}...`;
}

// =============================================
// Scanning
// =============================================

async function scanSessions(): Promise<ConversationMeta[]> {
	const metas: ConversationMeta[] = [];
	const seenIds = new Set<string>();

	for (const root of minimaxRoots()) {
		let stores: MinimaxSessionStore[];
		try {
			stores = await findSessionStores(root);
		} catch {
			// A root may disappear while a WSL distro stops; keep the others.
			continue;
		}

		for (const store of stores) {
			const id = minimaxSessionId(basename(store.dir));
			if (seenIds.has(id)) continue;
			seenIds.add(id);
			metas.push({
				id,
				source: SOURCE,
				filePath: store.activeFile,
				fileSize: store.fileSize,
				fileMtime: store.fileMtime.toISOString(),
				// The session files carry no cwd; the title is the first prompt.
				projectDir: "",
				rootDir: root,
			});
		}
	}

	return metas;
}

// =============================================
// Parsing
// =============================================

async function sessionMessageFiles(sessionDir: string): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(sessionDir, { withFileTypes: true });
	} catch {
		return [];
	}
	const files = entries
		.filter((entry) => entry.isFile() && isMessageFile(entry.name))
		.map((entry) => resolve(sessionDir, entry.name));
	// The active generation first: its copy of a message wins the de-duplication.
	files.sort((a, b) => {
		const aActive = basename(a) === "messages.jsonl";
		const bActive = basename(b) === "messages.jsonl";
		if (aActive !== bActive) return aActive ? -1 : 1;
		return a < b ? -1 : a > b ? 1 : 0;
	});
	return files;
}

interface MessageCandidate {
	message: ParsedMessage;
	rawTs: number | null;
	order: number;
}

async function parseSession(meta: ConversationMeta): Promise<ParsedConversation> {
	const conversationId = meta.id;
	const sessionDir = dirname(meta.filePath);
	const files = await sessionMessageFiles(sessionDir);

	const fallbackMs = (() => {
		const parsed = Date.parse(meta.fileMtime);
		return Number.isNaN(parsed) ? Date.now() : parsed;
	})();

	const candidates: MessageCandidate[] = [];
	const seenMessageIds = new Set<string>();

	for (const file of files) {
		let fileText = "";
		try {
			fileText = await readFile(file, "utf8");
		} catch {
			continue;
		}
		let lineIndex = 0;
		for (const line of fileText.split("\n")) {
			const currentLine = lineIndex;
			lineIndex += 1;
			if (!line.trim()) continue;

			let parsed: MinimaxLine;
			try {
				parsed = JSON.parse(line) as MinimaxLine;
			} catch {
				continue; // Skip malformed lines, keep the rest of the session.
			}
			if (!parsed || typeof parsed !== "object") continue;

			const raw = parsed.message;
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
			const role = stringField(raw.role);
			if (role !== "user" && role !== "assistant") continue;

			const messageId = stringField(parsed.message_id);
			const dedupeKey = messageId || `${file}:${currentLine}`;
			if (seenMessageIds.has(dedupeKey)) continue;
			seenMessageIds.add(dedupeKey);

			const rawTs = timestampMs(raw.timestamp);
			const id = messageId || `${conversationId}-${candidates.length}`;
			const base = {
				id,
				parentUuid: null,
				hasCode: false,
				timestamp: "",
			};

			if (role === "user") {
				const text = extractUserText(raw);
				if (!text) continue;
				candidates.push({
					message: {
						...base,
						type: "user",
						role: "user",
						content: text,
						hasToolUse: false,
						hasCode: text.includes("```"),
						thinking: null,
					},
					rawTs,
					order: candidates.length,
				});
				continue;
			}

			const extraction = extractAssistantContent(raw.content);
			if (
				!extraction.text &&
				!extraction.thinking &&
				!extraction.hasToolUse
			) {
				continue;
			}
			candidates.push({
				message: {
					...base,
					type: "assistant",
					role: "assistant",
					content: extraction.text,
					hasToolUse: extraction.hasToolUse,
					hasCode: extraction.text.includes("```"),
					thinking: extraction.thinking,
				},
				rawTs,
				order: candidates.length,
			});
		}
	}

	candidates.sort((a, b) => {
		const aKey = a.rawTs ?? fallbackMs + a.order;
		const bKey = b.rawTs ?? fallbackMs + b.order;
		if (aKey !== bKey) return aKey - bKey;
		return a.order - b.order;
	});

	const messages: ParsedMessage[] = [];
	let lastMs = Number.NEGATIVE_INFINITY;
	for (const candidate of candidates) {
		const rawMs = candidate.rawTs ?? fallbackMs + candidate.order;
		const timestamp =
			messages.length === 0 ? rawMs : Math.max(rawMs, lastMs + 1);
		lastMs = timestamp;
		messages.push({
			...candidate.message,
			timestamp: new Date(timestamp).toISOString(),
		});
	}

	const firstUserText =
		messages.find((message) => message.type === "user")?.content ?? "";
	const fallbackIso = new Date(fallbackMs).toISOString();

	return {
		id: conversationId,
		slug: truncateSlug(firstUserText),
		source: SOURCE,
		projectDir: "",
		projectName: "",
		cwd: null,
		gitBranch: null,
		messages,
		firstMessageAt: messages[0]?.timestamp ?? fallbackIso,
		lastMessageAt: messages[messages.length - 1]?.timestamp ?? fallbackIso,
	};
}

// =============================================
// MiniMax Code Adapter
// =============================================

export const minimaxCodeAdapter: SourceAdapter = {
	name: SOURCE,
	displayName: DISPLAY_NAME,
	parserVersion: "minimax-code@1",

	async detect(): Promise<SourceInfo | null> {
		try {
			const metas = await scanSessions();
			if (metas.length === 0) return null;
			return {
				name: SOURCE,
				displayName: DISPLAY_NAME,
				// The primary install stays the reported data dir even when the only
				// sessions found are inside a WSL distro.
				dataDir: getDataDir(),
				conversationCount: metas.length,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		return scanSessions();
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		return parseSession(meta);
	},

	watchPaths(): string[] {
		const sessionsDir = sessionsDirFor(getDataDir());
		if (!existsSync(sessionsDir)) return [];
		// Only the Windows-local store is watched: `\\wsl.localhost` paths are
		// slow and may start a stopped distro. WSL conversations sync on the next
		// manual Import.
		return [resolve(sessionsDir, "**", "messages*.jsonl")];
	},
};
