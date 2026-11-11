/**
 * Qwen Code adapter.
 *
 * Qwen Code is a Gemini CLI fork that stores each session as a Claude-Code
 * style append-only JSONL transcript under
 * `<dataDir>/projects/<mangled-cwd>/chats/*.jsonl` (subagent logs live under
 * `subagents/<session>/agent-*.jsonl` and are not main conversations).
 *
 * Every line is a self-contained record:
 *   { uuid, parentUuid, sessionId, timestamp, type, cwd, message }
 * where `type` is `user` / `assistant` (older builds also used `model`, and
 * tool-result/system records are noise) and `message` is a Gemini `Content`
 * object (`{ role, parts }`). Parts with `thought: true` are reasoning; parts
 * with `functionCall` / `functionResponse` mark tool use and their payloads are
 * not written into the message body. The session id is the file name (and is
 * repeated on every record); the project directory is the `cwd` the record
 * carries, with the mangled folder name as a fallback for older transcripts.
 */

import { createReadStream, existsSync } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
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

const SOURCE_NAME = "qwen";
const DISPLAY_NAME = "Qwen Code";
const PARSER_VERSION = "qwen@2";

const SESSION_FILE_PATTERN = /\.jsonl$/i;

/** How much of a transcript is read to recover its session id and cwd. */
const HEAD_BYTES = 16 * 1024;

/**
 * Record types that carry a conversation turn. Everything else (system,
 * tool_result, summary, compression checkpoints, …) is transcript metadata.
 */
const TURN_TYPES = new Set(["user", "assistant", "model"]);

// =============================================
// Raw Qwen Code transcript types
// =============================================

interface QwenPart {
	text?: string;
	thought?: boolean;
	functionCall?: { name?: string; args?: unknown };
	functionResponse?: unknown;
}

interface QwenMessage {
	role?: string;
	parts?: Array<QwenPart | string>;
	content?: string | Array<QwenPart | string>;
}

interface QwenRecord {
	uuid?: string;
	id?: string;
	parentUuid?: string | null;
	sessionId?: string;
	timestamp?: string | number;
	type?: string;
	cwd?: string;
	gitBranch?: string;
	message?: QwenMessage | string;
}

interface SessionHead {
	sessionId: string | null;
	cwd: string | null;
}

interface ExtractedContent {
	text: string;
	thinking: string | null;
	hasToolUse: boolean;
}

// =============================================
// Value helpers
// =============================================

/**
 * Normalize the timestamp shapes Qwen has used (RFC 3339 strings and numeric
 * Unix seconds/milliseconds) to an ISO string.
 */
function normalizeTimestamp(value: unknown, fallback: string): string {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
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

async function fileMtimeIso(filePath: string): Promise<string> {
	try {
		const fileStat = await stat(filePath);
		return fileStat.mtime.toISOString();
	} catch {
		return new Date(0).toISOString();
	}
}

function projectNameFromCwd(cwd: string | null): string {
	if (!cwd) return "Qwen";
	const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? "Qwen";
}

/**
 * Decode Qwen's Claude-Code-style project folder name back into a path:
 * separators (and the `:` of a Windows drive) are written as `-`, so
 * `C--Users-me-code-app` is `C:\Users\me\code\app` and `-home-me-app` is
 * `/home/me/app`. The encoding cannot represent a real `-` in a folder name,
 * so this is a best-effort fallback used only when a transcript records no cwd.
 */
function decodeProjectPath(dirName: string): string {
	if (/^[A-Za-z]--/.test(dirName)) {
		const drive = dirName[0].toUpperCase();
		const segments = dirName
			.slice(3)
			.split("-")
			.filter((segment) => segment.length > 0);
		return `${drive}:\\${segments.join("\\")}`;
	}
	if (dirName.startsWith("-")) {
		const segments = dirName
			.slice(1)
			.split("-")
			.filter((segment) => segment.length > 0);
		return `/${segments.join("/")}`;
	}
	return dirName;
}

// =============================================
// Content extraction
// =============================================

function extractContent(message: QwenMessage | string | undefined): ExtractedContent {
	const texts: string[] = [];
	const thinkingParts: string[] = [];
	let hasToolUse = false;

	const visitPart = (part: QwenPart | string): void => {
		if (typeof part === "string") {
			if (part.trim()) texts.push(part);
			return;
		}
		if (!part || typeof part !== "object") return;
		if (typeof part.text === "string" && part.text.trim()) {
			if (part.thought) thinkingParts.push(part.text);
			else texts.push(part.text);
		}
		if (part.functionCall || part.functionResponse) hasToolUse = true;
	};

	if (typeof message === "string") {
		if (message.trim()) texts.push(message);
	} else if (message && typeof message === "object") {
		if (Array.isArray(message.parts)) {
			for (const part of message.parts) visitPart(part);
		} else if (typeof message.content === "string") {
			if (message.content.trim()) texts.push(message.content);
		} else if (Array.isArray(message.content)) {
			for (const part of message.content) visitPart(part);
		}
	}

	return {
		text: texts.join("\n").trim(),
		thinking: thinkingParts.length > 0 ? thinkingParts.join("\n") : null,
		hasToolUse,
	};
}

// =============================================
// Transcript helpers
// =============================================

/** Read the session id and cwd from the opening bytes of a transcript. */
async function readSessionHead(filePath: string): Promise<SessionHead> {
	let handle: FileHandle;
	try {
		handle = await open(filePath, "r");
	} catch {
		return { sessionId: null, cwd: null };
	}
	try {
		const buffer = Buffer.alloc(HEAD_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const head = buffer
			.subarray(0, bytesRead)
			.toString("utf-8")
			.replace(/^\uFEFF/, "");
		const firstLine = head
			.split(/\r?\n/)
			.find((line) => line.trim().length > 0);
		if (!firstLine) return { sessionId: null, cwd: null };
		try {
			const record = JSON.parse(firstLine) as QwenRecord;
			return {
				sessionId:
					typeof record.sessionId === "string" && record.sessionId
						? record.sessionId
						: null,
				cwd: typeof record.cwd === "string" && record.cwd ? record.cwd : null,
			};
		} catch {
			// Partially written first line; the file name is the session id.
			return { sessionId: null, cwd: null };
		}
	} finally {
		await handle.close();
	}
}

function toParsedMessage(
	record: QwenRecord,
	conversationId: string,
	index: number,
	fallbackTimestamp: string,
): ParsedMessage | null {
	if (!record || typeof record !== "object") return null;

	const rawType = (record.type ?? "").toLowerCase();
	let type: "user" | "assistant" | null = null;
	if (TURN_TYPES.has(rawType)) {
		type =
			rawType === "user" ? "user" : "assistant";
	} else if (rawType) {
		return null; // tool_result / system / summary / control records
	} else {
		// Very old records had no top-level type; the message role is the hint.
		const role =
			record.message &&
			typeof record.message === "object" &&
			typeof record.message.role === "string"
				? record.message.role
				: "";
		if (role === "user") type = "user";
		else if (role === "model" || role === "assistant") type = "assistant";
	}
	if (!type) return null;

	const { text, thinking, hasToolUse } = extractContent(record.message);
	if (!text && !thinking && !hasToolUse) return null;

	return {
		id: record.uuid?.trim() || record.id?.trim() || `${conversationId}-${index}`,
		parentUuid: record.parentUuid ?? null,
		type,
		role: type,
		content: text,
		hasToolUse,
		hasCode: text.includes("```"),
		thinking,
		timestamp: normalizeTimestamp(record.timestamp, fallbackTimestamp),
	};
}

// =============================================
// Session discovery
// =============================================

/**
 * Qwen Code home folders to scan: the local install plus every running WSL
 * distro home that has a `.qwen` folder.
 */
function qwenRoots(): string[] {
	return withWslRoots(appConfig.qwenDataDir, ".qwen");
}

/** Session metadata below one Qwen home (`<root>/projects/<mangled>/chats/`). */
async function collectRootSessionFiles(root: string): Promise<ConversationMeta[]> {
	const projectsDir = resolve(root, "projects");
	if (!existsSync(projectsDir)) return [];

	let projectEntries: Dirent[];
	try {
		projectEntries = await readdir(projectsDir, { withFileTypes: true });
	} catch {
		return [];
	}

	const metas: ConversationMeta[] = [];
	for (const projectEntry of projectEntries) {
		if (!projectEntry.isDirectory()) continue;
		const mangledDir = projectEntry.name;
		const chatsDir = resolve(projectsDir, mangledDir, "chats");
		if (!existsSync(chatsDir)) continue;

		let chatEntries: Dirent[];
		try {
			chatEntries = await readdir(chatsDir, { withFileTypes: true });
		} catch {
			continue;
		}

		const decodedDir = decodeProjectPath(mangledDir);
		for (const chatEntry of chatEntries) {
			// Subagent transcripts are nested below `subagents/`, never in `chats/`.
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
			// Empty transcripts are created before the first turn is flushed.
			if (fileStat.size < 2) continue;

			const head = await readSessionHead(filePath);
			const fallbackId = basename(chatEntry.name, ".jsonl");
			metas.push({
				id: head.sessionId ?? fallbackId,
				source: SOURCE_NAME,
				filePath,
				fileSize: fileStat.size,
				fileMtime: fileStat.mtime.toISOString(),
				projectDir: head.cwd ?? decodedDir,
				rootDir: root,
			});
		}
	}

	return metas;
}

async function collectSessionFiles(): Promise<ConversationMeta[]> {
	const metas: ConversationMeta[] = [];
	for (const root of qwenRoots()) {
		try {
			metas.push(...(await collectRootSessionFiles(root)));
		} catch {
			// A WSL distro can stop while reading; keep the other roots' sessions.
		}
	}
	return metas;
}

// =============================================
// Qwen Code Adapter
// =============================================

export const qwenAdapter: SourceAdapter = {
	name: SOURCE_NAME,
	displayName: DISPLAY_NAME,
	parserVersion: PARSER_VERSION,

	async detect(): Promise<SourceInfo | null> {
		try {
			const metas = await collectSessionFiles();
			if (metas.length === 0) return null;
			return {
				name: SOURCE_NAME,
				displayName: DISPLAY_NAME,
				dataDir: appConfig.qwenDataDir,
				conversationCount: metas.length,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		try {
			return await collectSessionFiles();
		} catch {
			return [];
		}
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		const fallbackTimestamp = await fileMtimeIso(meta.filePath);
		const messages: ParsedMessage[] = [];

		let recordedCwd: string | null = null;
		let gitBranch: string | null = null;
		let index = 0;

		try {
			const readline = createInterface({
				input: createReadStream(meta.filePath, { encoding: "utf-8" }),
				crlfDelay: Number.POSITIVE_INFINITY,
			});

			for await (const line of readline) {
				if (!line.trim()) continue;
				let record: QwenRecord;
				try {
					record = JSON.parse(line) as QwenRecord;
				} catch {
					continue; // Qwen can leave a partial trailing line while writing.
				}
				if (!record || typeof record !== "object") continue;

				if (!recordedCwd && typeof record.cwd === "string" && record.cwd) {
					recordedCwd = record.cwd;
				}
				if (!gitBranch && typeof record.gitBranch === "string") {
					gitBranch = record.gitBranch;
				}

				const message = toParsedMessage(
					record,
					meta.id,
					index,
					fallbackTimestamp,
				);
				index++;
				if (message) messages.push(message);
			}
		} catch (err) {
			// A broken transcript still imports whatever was readable.
			console.warn(
				`[Qwen] Failed to read ${meta.filePath}:`,
				err instanceof Error ? err.message : err,
			);
		}

		const cwd = recordedCwd ?? (meta.projectDir || null);
		return {
			id: meta.id,
			slug: null,
			source: SOURCE_NAME,
			projectDir: cwd ?? "",
			projectName: projectNameFromCwd(cwd),
			cwd,
			gitBranch,
			messages,
			firstMessageAt: messages[0]?.timestamp ?? fallbackTimestamp,
			lastMessageAt:
				messages[messages.length - 1]?.timestamp ?? fallbackTimestamp,
		};
	},

	watchPaths(): string[] {
		// Only the local root is watched: chokidar cannot watch UNC paths, and
		// touching a stopped WSL distro would start it. WSL sessions are picked
		// up by the next manual Import.
		const root = appConfig.qwenDataDir;
		if (!existsSync(root)) return [];
		return [resolve(root, "projects", "**", "chats", "*.jsonl")];
	},
};
