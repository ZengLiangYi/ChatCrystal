import { createReadStream, existsSync } from "node:fs";
import { open, readdir, stat, type FileHandle } from "node:fs/promises";
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

/**
 * Factory Droid adapter.
 *
 * Droid stores one transcript per session as JSONL: `<droidDataDir>/sessions/<id>.jsonl`
 * for older sessions, or `<droidDataDir>/sessions/<cwd-encoded>/<id>.jsonl` for
 * newer ones. The first line is a `session_start` event (id, title, cwd, and
 * the forked/sub-agent links); every following line is either a `message`
 * event (`{ id, timestamp, message: { role, content } }`, with Anthropic-style
 * content blocks) or another event that we skip. `<id>.settings.json` sits
 * beside the transcript and is not conversation content.
 */

const SOURCE = "droid";
const DISPLAY_NAME = "Factory Droid";
const SESSIONS_DIR = "sessions";

interface DroidSessionStart {
	type?: unknown;
	id?: unknown;
	title?: unknown;
	cwd?: unknown;
	lastCwd?: unknown;
	parent?: unknown;
	callingSessionId?: unknown;
	forkedAtMessageId?: unknown;
}

interface DroidEvent {
	type?: unknown;
	id?: unknown;
	timestamp?: unknown;
	message?: unknown;
}

interface DroidRawMessage {
	role?: unknown;
	content?: unknown;
}

/** How deep below `sessions/` a transcript may sit. */
const SESSION_WALK_DEPTH = 1;
/** Cap for reading a transcript's first line (the session_start event). */
const FIRST_LINE_BYTES = 64 * 1024;

function getDataDir(): string {
	return appConfig.droidDataDir;
}

/**
 * Droid home folders to scan: the local install plus every running WSL distro
 * home that has a `.factory` folder.
 */
function droidRoots(): string[] {
	return withWslRoots(getDataDir(), ".factory");
}

function sessionsDirFor(root: string): string {
	return resolve(root, SESSIONS_DIR);
}

// =============================================
// Session discovery
// =============================================

async function findTranscriptFiles(root: string): Promise<string[]> {
	const sessionsDir = sessionsDirFor(root);
	if (!existsSync(sessionsDir)) return [];

	const files: string[] = [];
	async function collect(dir: string, remainingDepth: number): Promise<void> {
		try {
			const entries = await readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = resolve(dir, entry.name);
				if (entry.isFile()) {
					if (entry.name.endsWith(".jsonl")) files.push(fullPath);
				} else if (entry.isDirectory() && remainingDepth > 0) {
					await collect(fullPath, remainingDepth - 1);
				}
			}
		} catch {
			// Unreadable directory: nothing to import below it.
		}
	}

	await collect(sessionsDir, SESSION_WALK_DEPTH);
	return files;
}

/** Read only the first line of a file, without loading the whole transcript. */
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

async function readSessionStart(filePath: string): Promise<DroidSessionStart | null> {
	const firstLine = await readFirstLine(filePath);
	if (!firstLine) return null;
	try {
		const parsed = JSON.parse(firstLine.replace(/^\uFEFF/, "")) as DroidSessionStart;
		return parsed && parsed.type === "session_start" ? parsed : null;
	} catch {
		return null;
	}
}

async function scanSessions(): Promise<ConversationMeta[]> {
	const metas: ConversationMeta[] = [];

	for (const root of droidRoots()) {
		let files: string[];
		try {
			files = await findTranscriptFiles(root);
		} catch {
			// A WSL distro can stop while reading; keep the other roots' sessions.
			continue;
		}

		for (const filePath of files) {
			try {
				const fileStat = await stat(filePath);
				if (fileStat.size === 0) continue;
				const sessionStart = await readSessionStart(filePath);
				const fallbackId = basename(filePath, ".jsonl");
				// scan() must reuse the transcript's own id so that import dedup and
				// parsed.id stay aligned; fall back to the file name only when the
				// header cannot be read.
				const id =
					typeof sessionStart?.id === "string" && sessionStart.id
						? sessionStart.id
						: fallbackId;
				const cwd = pickCwd(sessionStart);
				metas.push({
					id,
					source: SOURCE,
					filePath,
					fileSize: fileStat.size,
					fileMtime: fileStat.mtime.toISOString(),
					projectDir: cwd,
					rootDir: root,
				});
			} catch {
				// Unreadable transcript.
			}
		}
	}

	return metas;
}

// =============================================
// Helpers
// =============================================

function stringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** `lastCwd` wins over `cwd`: Droid updates it as the session moves. */
function pickCwd(sessionStart: DroidSessionStart | null): string {
	if (!sessionStart) return "";
	return stringField(sessionStart.lastCwd) || stringField(sessionStart.cwd);
}

function extractProjectName(projectDir: string): string {
	const normalized = projectDir.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] || projectDir;
}

/** Normalize a Droid title; "New Session" is Droid's placeholder, not a title. */
function normalizeTitle(value: unknown): string | null {
	const title = stringField(value);
	if (!title) return null;
	if (title.toLowerCase() === "new session") return null;
	return title;
}

function toIsoTimestamp(value: unknown, fallback: string): string {
	if (typeof value === "number" && Number.isFinite(value)) {
		return new Date(value).toISOString();
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) return fallback;
		if (/^\d+(\.\d+)?$/.test(trimmed)) {
			const epoch = Number(trimmed);
			if (Number.isFinite(epoch)) return new Date(epoch).toISOString();
		}
		const parsed = Date.parse(trimmed);
		if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
	}
	return fallback;
}

interface ExtractedContent {
	text: string;
	thinking: string | null;
	hasToolUse: boolean;
}

/**
 * Extract text/thinking/tool-use from a Droid message's `content`, which may be
 * a plain string or an array of Anthropic content blocks. `tool_result` blocks
 * are tool output, not conversation text, and are skipped.
 */
function extractContent(content: unknown): ExtractedContent {
	if (typeof content === "string") {
		return { text: content.trim(), thinking: null, hasToolUse: false };
	}
	if (!Array.isArray(content)) {
		return { text: "", thinking: null, hasToolUse: false };
	}

	const texts: string[] = [];
	const thinkingParts: string[] = [];
	let hasToolUse = false;

	for (const item of content) {
		if (!item || typeof item !== "object") continue;
		const block = item as { type?: unknown; text?: unknown; thinking?: unknown };
		const type = typeof block.type === "string" ? block.type : "";
		if (type === "text" && typeof block.text === "string") {
			texts.push(block.text);
		} else if (type === "thinking" && typeof block.thinking === "string") {
			thinkingParts.push(block.thinking);
		} else if (type === "tool_use") {
			hasToolUse = true;
		}
	}

	return {
		text: texts.join("\n").trim(),
		thinking: thinkingParts.length > 0 ? thinkingParts.join("\n") : null,
		hasToolUse,
	};
}

function emptyConversation(meta: ConversationMeta): ParsedConversation {
	const projectDir = meta.projectDir || "";
	return {
		id: meta.id,
		slug: null,
		source: SOURCE,
		projectDir,
		projectName: projectDir ? extractProjectName(projectDir) : "",
		cwd: projectDir || null,
		gitBranch: null,
		messages: [],
		firstMessageAt: meta.fileMtime,
		lastMessageAt: meta.fileMtime,
	};
}

// =============================================
// Droid Adapter
// =============================================

export const droidAdapter: SourceAdapter = {
	name: SOURCE,
	displayName: DISPLAY_NAME,
	parserVersion: "droid@2",

	async detect(): Promise<SourceInfo | null> {
		const metas = await scanSessions();
		if (metas.length === 0) return null;

		return {
			name: SOURCE,
			displayName: DISPLAY_NAME,
			dataDir: getDataDir(),
			conversationCount: metas.length,
		};
	},

	async scan(): Promise<ConversationMeta[]> {
		return scanSessions();
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		// import() pairs parse(meta) with the meta it scanned, so meta.id is the
		// conversation id; the transcript header supplies project metadata.
		const conversationId = meta.id || basename(meta.filePath, ".jsonl");
		const messages: ParsedMessage[] = [];
		let sessionStart: DroidSessionStart | null = null;

		const lineReader = createInterface({
			input: createReadStream(meta.filePath, { encoding: "utf-8" }),
			crlfDelay: Number.POSITIVE_INFINITY,
		});
		try {
			for await (const line of lineReader) {
				const trimmed = line.trim();
				if (!trimmed) continue;

				let event: DroidEvent;
				try {
					event = JSON.parse(trimmed.replace(/^\uFEFF/, "")) as DroidEvent;
				} catch {
					continue; // Skip malformed lines.
				}
				if (!event || typeof event !== "object") continue;

				if (event.type === "session_start") {
					if (!sessionStart) sessionStart = event as DroidSessionStart;
					continue;
				}

				if (event.type !== "message") continue;
				const rawMessage =
					event.message && typeof event.message === "object"
						? (event.message as DroidRawMessage)
						: undefined;
				const role = stringField(rawMessage?.role);
				if (role !== "user" && role !== "assistant") continue;

				const { text, thinking, hasToolUse } = extractContent(rawMessage?.content);

				if (role === "user") {
					// Droid injects environment context and <system-notification>
					// blocks as user turns; those start with "<" and are noise.
					if (!text || text.startsWith("<")) continue;
				} else if (!text && !thinking && !hasToolUse) {
					continue;
				}

				const timestamp = toIsoTimestamp(event.timestamp, meta.fileMtime);
				const eventId = stringField(event.id);
				messages.push({
					id: eventId || `${conversationId}-${messages.length}`,
					parentUuid: null,
					type: role,
					role,
					content: text,
					hasToolUse,
					hasCode: text.includes("```"),
					thinking,
					timestamp,
				});
			}
		} finally {
			lineReader.close();
		}

		if (messages.length === 0 && !sessionStart) {
			return emptyConversation(meta);
		}

		const projectDir = pickCwd(sessionStart) || meta.projectDir || "";
		return {
			id: conversationId,
			slug: normalizeTitle(sessionStart?.title),
			source: SOURCE,
			projectDir,
			projectName: projectDir ? extractProjectName(projectDir) : "",
			cwd: projectDir || null,
			gitBranch: null,
			messages,
			firstMessageAt: messages[0]?.timestamp ?? meta.fileMtime,
			lastMessageAt: messages[messages.length - 1]?.timestamp ?? meta.fileMtime,
		};
	},

	watchPaths(): string[] {
		// Only the local root is watched: chokidar cannot watch UNC paths, and
		// touching a stopped WSL distro would start it. WSL sessions are picked
		// up by the next manual Import.
		return [resolve(sessionsDirFor(getDataDir()), "**", "*.jsonl")];
	},
};
