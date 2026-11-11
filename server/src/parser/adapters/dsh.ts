import { existsSync, type Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type {
	ConversationMeta,
	ParsedConversation,
	ParsedMessage,
	SourceInfo,
} from "@chatcrystal/shared";
import { appConfig } from "../../config.js";
import type { SourceAdapter } from "../adapter.js";
import { withWslRoots } from "../sourceRoots.js";
import { readMaybeZstdFile } from "../zstd.js";

// =============================================
// DeepSeek Harness (dsh) session format
// =============================================
//
// <dshSessionsDir>/<encoded-project>/<session-dir>/session.v<N>.jsonl[.zstd]
//
// The log is one event per line: {type, seq, time(ms), data}. The first line is
// the session header (type "session"). Carried-over sessions keep their older
// generation file beside the new one, so only the highest version is read.
// Files are usually a concatenation of zstd frames (one per append batch), see
// ../zstd.ts. Older builds wrote plain session.jsonl / session.v3.jsonl.
//
// The same layout also lives inside a WSL distro (`~/.dsh/sessions`), so every
// root returned by `withWslRoots` is scanned.

const SESSION_FILE_PATTERN = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/;
const WSL_RELATIVE_DIR = ".dsh/sessions";

interface DshHeader {
	type?: string;
	version?: number;
	id?: string;
	createdAt?: number;
	cwd?: string;
	parentSession?: string;
	origin?: string;
	delegationDepth?: number;
}

interface DshContentBlock {
	type?: string;
	text?: string;
}

interface DshMessageContent {
	content?: DshContentBlock[];
	id?: string;
}

interface DshEventData {
	/** user/message blocks */
	content?: DshContentBlock[];
	source?: { kind?: string };
	/** user/message record id */
	id?: string;
	/** assistant/message payload */
	message?: DshMessageContent;
	/** session/title payload */
	title?: string;
}

interface DshEvent {
	type?: string;
	seq?: number;
	time?: number;
	data?: DshEventData;
}

interface DshSessionFile {
	/** Session directory name, used as the conversation id. */
	sessionDirName: string;
	filePath: string;
	fileSize: number;
	fileMtime: string;
}

/** Choose the newest generation session file of one session directory. */
async function pickSessionFile(
	sessionPath: string,
): Promise<Omit<DshSessionFile, "sessionDirName"> | null> {
	let entries: Dirent[];
	try {
		entries = await readdir(sessionPath, { withFileTypes: true });
	} catch {
		return null;
	}

	let best: {
		filePath: string;
		version: number;
		mtimeMs: number;
		fileSize: number;
		fileMtime: string;
	} | null = null;

	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const match = SESSION_FILE_PATTERN.exec(entry.name);
		if (!match) continue;

		const version = match[1] ? Number.parseInt(match[1], 10) : 0;
		const filePath = resolve(sessionPath, entry.name);
		let fileStat: Awaited<ReturnType<typeof stat>>;
		try {
			fileStat = await stat(filePath);
		} catch {
			continue;
		}

		const isNewer =
			!best ||
			version > best.version ||
			(version === best.version && fileStat.mtimeMs > best.mtimeMs);
		if (!isNewer) continue;

		best = {
			filePath,
			version,
			mtimeMs: fileStat.mtimeMs,
			fileSize: fileStat.size,
			fileMtime: fileStat.mtime.toISOString(),
		};
	}

	if (!best) return null;
	return {
		filePath: best.filePath,
		fileSize: best.fileSize,
		fileMtime: best.fileMtime,
	};
}

/** Session roots to scan: the local install plus every WSL distro home. */
function sessionsRoots(): string[] {
	return withWslRoots(appConfig.dshSessionsDir, WSL_RELATIVE_DIR);
}

/**
 * Collect the session files below one sessions root. Reads directory entries
 * and stats only — conversation content is parsed lazily by `parse()`.
 */
async function collectSessionFiles(root: string): Promise<DshSessionFile[]> {
	if (!existsSync(root)) return [];

	const sessions: DshSessionFile[] = [];

	let projectEntries: Dirent[];
	try {
		projectEntries = await readdir(root, { withFileTypes: true });
	} catch {
		return [];
	}

	for (const projectEntry of projectEntries) {
		if (!projectEntry.isDirectory() || projectEntry.name.startsWith(".")) continue;
		const projectPath = resolve(root, projectEntry.name);

		let sessionEntries: Dirent[];
		try {
			sessionEntries = await readdir(projectPath, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const sessionEntry of sessionEntries) {
			if (!sessionEntry.isDirectory() || sessionEntry.name.startsWith(".")) {
				continue;
			}
			const picked = await pickSessionFile(resolve(projectPath, sessionEntry.name));
			if (!picked) continue;
			sessions.push({ sessionDirName: sessionEntry.name, ...picked });
		}
	}

	return sessions;
}

// =============================================
// Content helpers
// =============================================

/** Join the text blocks of a content array; non-text blocks are ignored. */
function joinTextBlocks(blocks: DshContentBlock[] | undefined): string {
	if (!Array.isArray(blocks)) return "";
	return blocks
		.filter((block) => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text as string)
		.join("\n");
}

/** Join the reasoning blocks of an assistant message. */
function joinReasoningBlocks(blocks: DshContentBlock[] | undefined): string {
	if (!Array.isArray(blocks)) return "";
	return blocks
		.filter(
			(block) => block?.type === "reasoning" && typeof block.text === "string",
		)
		.map((block) => block.text as string)
		.join("\n");
}

/** Drop harness-injected reminders if one ever lands in a real user message. */
function sanitizeUserText(text: string): string {
	return text
		.replace(/<system-reminder(?:\s[^>]*)?>[\s\S]*?<\/system-reminder>/g, "")
		.trim();
}

/**
 * The fallback title is cut from the first prompt, which for a delegated
 * subagent session is harness context rather than a human request. Strip any
 * injected reminder; a title that is still XML-ish is unusable.
 */
function sanitizeSessionTitle(title: string): string {
	const cleaned = title
		.replace(/<system-reminder(?:\s[^>]*)?>[\s\S]*?<\/system-reminder>/g, "")
		.trim();
	if (!cleaned || cleaned.startsWith("<")) return "";
	return cleaned;
}

/** Last path segment, accepting both Windows and POSIX separators. */
function extractProjectName(path: string): string {
	const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? "";
}

function timestampToIso(
	event: DshEvent,
	header: DshHeader | null,
	fallbackIso: string,
): string {
	if (typeof event.time === "number" && Number.isFinite(event.time)) {
		return new Date(event.time).toISOString();
	}
	if (typeof header?.createdAt === "number" && Number.isFinite(header.createdAt)) {
		return new Date(header.createdAt).toISOString();
	}
	return fallbackIso;
}

// =============================================
// DeepSeek Harness Adapter
// =============================================

export const dshAdapter: SourceAdapter = {
	name: "dsh",
	displayName: "DeepSeek Harness",
	parserVersion: "dsh@2",

	async detect(): Promise<SourceInfo | null> {
		try {
			let conversationCount = 0;
			for (const root of sessionsRoots()) {
				try {
					conversationCount += (await collectSessionFiles(root)).length;
				} catch {
					// A WSL distro can stop mid-scan; keep the other roots.
				}
			}
			if (conversationCount === 0) return null;

			return {
				name: "dsh",
				displayName: "DeepSeek Harness",
				dataDir: appConfig.dshSessionsDir,
				conversationCount,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		const metas: ConversationMeta[] = [];
		for (const root of sessionsRoots()) {
			try {
				for (const session of await collectSessionFiles(root)) {
					metas.push({
						id: session.sessionDirName,
						source: "dsh",
						filePath: session.filePath,
						fileSize: session.fileSize,
						fileMtime: session.fileMtime,
						// cwd comes from the session header in parse().
						projectDir: "",
						rootDir: root,
					});
				}
			} catch {
				// A stopped distro must not abort the local scan.
			}
		}
		return metas;
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		const messages: ParsedMessage[] = [];
		let header: DshHeader | null = null;
		let slug: string | null = null;
		let lastAssistantMessage: ParsedMessage | null = null;

		let fileText = "";
		try {
			fileText = await readMaybeZstdFile(meta.filePath);
		} catch {
			fileText = "";
		}

		const fileMtimeIso = meta.fileMtime || new Date().toISOString();

		for (const line of fileText.split("\n")) {
			if (!line.trim()) continue;

			let event: DshEvent;
			try {
				event = JSON.parse(line) as DshEvent;
			} catch {
				continue; // Truncated / malformed line (e.g. an interrupt mid-write)
			}
			if (!event || typeof event !== "object") continue;

			if (event.type === "session") {
				header = event as unknown as DshHeader;
				continue;
			}

			const data = event.data;
			if (!data) continue;

			switch (event.type) {
				case "user/message": {
					// Only what a person typed counts. The same event type carries
					// plugin/runtime context (skill catalogue, approval notices,
					// time context, subagent reports) under other source kinds.
					if (data.source?.kind !== "user") break;
					const text = sanitizeUserText(joinTextBlocks(data.content));
					if (!text) break;

					const message: ParsedMessage = {
						id: data.id || `${meta.id}-u-${event.seq ?? messages.length}`,
						parentUuid: null,
						type: "user",
						role: "user",
						content: text,
						hasToolUse: false,
						hasCode: text.includes("```"),
						thinking: null,
						timestamp: timestampToIso(event, header, fileMtimeIso),
					};
					messages.push(message);
					break;
				}

				case "assistant/message": {
					const blocks = data.message?.content;
					const text = joinTextBlocks(blocks);
					const thinking = joinReasoningBlocks(blocks);
					const hasToolUse = Array.isArray(blocks)
						? blocks.some((block) => block?.type === "tool-call")
						: false;
					if (!text && !thinking && !hasToolUse) break;

					const message: ParsedMessage = {
						id: `${meta.id}-a-${event.seq ?? messages.length}`,
						parentUuid: null,
						type: "assistant",
						role: "assistant",
						content: text,
						hasToolUse,
						hasCode: text.includes("```"),
						thinking: thinking || null,
						timestamp: timestampToIso(event, header, fileMtimeIso),
					};
					messages.push(message);
					lastAssistantMessage = message;
					break;
				}

				case "tool/call": {
					// Some steps report the call as a standalone event; mark the
					// assistant turn that made it as tool-using.
					if (lastAssistantMessage) lastAssistantMessage.hasToolUse = true;
					break;
				}

				case "session/title": {
					// Written more than once (fallback title, then the model's);
					// the last usable one wins.
					const title = sanitizeSessionTitle(
						typeof data.title === "string" ? data.title : "",
					);
					if (title) slug = title;
					break;
				}

				// Everything else (system/message, tool/result, step/*, turn/*,
				// request/*, command/*, ...) is harness bookkeeping, not history.
				default:
					break;
			}
		}

		const cwd = header?.cwd?.trim() || null;
		const projectDir = cwd || meta.projectDir || "";
		const fallbackTimestamp =
			typeof header?.createdAt === "number" && Number.isFinite(header.createdAt)
				? new Date(header.createdAt).toISOString()
				: fileMtimeIso;

		return {
			id: meta.id,
			slug,
			source: "dsh",
			projectDir,
			projectName: extractProjectName(projectDir),
			cwd,
			gitBranch: null,
			messages,
			firstMessageAt: messages[0]?.timestamp ?? fallbackTimestamp,
			lastMessageAt:
				messages[messages.length - 1]?.timestamp ?? fallbackTimestamp,
		};
	},

	watchPaths(): string[] {
		// Watch the local install only: watching `\\wsl.localhost` UNC paths is
		// slow and would start stopped distros. WSL sessions are picked up on the
		// next manual Import.
		return [resolve(appConfig.dshSessionsDir, "**/session*.jsonl*")];
	},
};
