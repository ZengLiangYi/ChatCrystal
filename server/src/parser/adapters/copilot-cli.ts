import { createReadStream, existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
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
 * GitHub Copilot CLI adapter.
 *
 * Copilot CLI keeps one append-only event log per session under
 * `<copilotCliDataDir>/session-state/<sessionId>/events.jsonl`, one
 * `{ type, data, timestamp }` event per line. Conversation turns are
 * `user.message` / `assistant.message` events whose `data.content` is a plain
 * string; tool work is filed separately as `tool.execution_start` events, which
 * mark the preceding assistant message as a tool-use turn. Everything else
 * (`tool.execution_complete`, `session.shutdown`, `session.info`, ...) is
 * ignored.
 *
 * The directory name is the stable conversation id: the `sessionId` repeated
 * inside `session.start` is identical in practice, and using the directory name
 * keeps scan()/parse() ids aligned even if a copied log disagrees.
 *
 * The same layout also lives inside a WSL distro (`~/.copilot`), so every root
 * returned by `withWslRoots` is scanned.
 */

const SOURCE = "copilot-cli";
const DISPLAY_NAME = "Copilot CLI";
const SESSION_STATE_DIR = "session-state";
const EVENTS_FILE = "events.jsonl";
/** Copilot CLI home relative to a WSL distro user home. */
const WSL_RELATIVE_DIR = ".copilot";

interface CopilotCliEvent {
	type?: unknown;
	data?: unknown;
	timestamp?: unknown;
}

interface SessionFile {
	sessionId: string;
	filePath: string;
}

/** Data roots to scan: the local install plus every WSL distro home. */
function dataRoots(): string[] {
	return withWslRoots(appConfig.copilotCliDataDir, WSL_RELATIVE_DIR);
}

function getSessionStateDir(
	root: string = appConfig.copilotCliDataDir,
): string {
	return resolve(root, SESSION_STATE_DIR);
}

// =============================================
// Session discovery
// =============================================

async function findSessionFiles(root: string): Promise<SessionFile[]> {
	const sessionStateDir = getSessionStateDir(root);
	if (!existsSync(sessionStateDir)) return [];

	const sessions: SessionFile[] = [];
	try {
		const entries = await readdir(sessionStateDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const filePath = resolve(sessionStateDir, entry.name, EVENTS_FILE);
			// A session directory can outlive its events.jsonl; only import
			// sessions whose log is still on disk.
			if (!existsSync(filePath)) continue;
			sessions.push({ sessionId: entry.name, filePath });
		}
	} catch {
		// Session state directory unreadable.
	}
	return sessions;
}

async function scanRoot(root: string): Promise<ConversationMeta[]> {
	const sessions = await findSessionFiles(root);
	const metas: ConversationMeta[] = [];

	for (const session of sessions) {
		try {
			const fileStat = await stat(session.filePath);
			if (fileStat.size === 0) continue;
			metas.push({
				id: session.sessionId,
				source: SOURCE,
				filePath: session.filePath,
				fileSize: fileStat.size,
				fileMtime: fileStat.mtime.toISOString(),
				// cwd is only known after reading session.start; parse() fills the
				// project metadata from the log itself.
				projectDir: "",
				rootDir: root,
			});
		} catch {
			// File vanished between discovery and stat.
		}
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

// =============================================
// Helpers
// =============================================

/**
 * Normalize an event timestamp. Copilot CLI writes ISO 8601 strings; older
 * builds (and fixtures) may use epoch milliseconds, so accept both.
 */
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

/**
 * Extract `data.content` as text. The documented shape is a plain string; a
 * few builds record content blocks instead, so accept those defensively.
 */
function extractContent(data: Record<string, unknown> | undefined): string {
	const content = data?.content;
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";

	const texts: string[] = [];
	for (const item of content) {
		if (!item || typeof item !== "object") continue;
		const block = item as { type?: unknown; text?: unknown };
		if (typeof block.text !== "string") continue;
		if (block.type === undefined || block.type === "text") {
			texts.push(block.text);
		}
	}
	return texts.join("\n").trim();
}

function extractProjectName(projectDir: string): string {
	const normalized = projectDir.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] || projectDir;
}

// =============================================
// Copilot CLI Adapter
// =============================================

export const copilotCliAdapter: SourceAdapter = {
	name: SOURCE,
	displayName: DISPLAY_NAME,
	parserVersion: "copilot-cli@2",

	async detect(): Promise<SourceInfo | null> {
		try {
			const metas = await scanSessions();
			if (metas.length === 0) return null;

			return {
				name: SOURCE,
				displayName: DISPLAY_NAME,
				dataDir: appConfig.copilotCliDataDir,
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
		const sessionId = meta.id || basename(dirname(meta.filePath));
		const messages: ParsedMessage[] = [];
		let cwd: string | null = null;
		// Tool events carry no conversation text; they only flag the assistant
		// message they belong to.
		let lastAssistantMessage: ParsedMessage | null = null;
		let messageIndex = 0;

		const lineReader = createInterface({
			input: createReadStream(meta.filePath, { encoding: "utf-8" }),
			crlfDelay: Number.POSITIVE_INFINITY,
		});
		try {
			for await (const line of lineReader) {
				if (!line.trim()) continue;

				let event: CopilotCliEvent;
				try {
					event = JSON.parse(line) as CopilotCliEvent;
				} catch {
					continue; // Skip malformed lines.
				}
				if (!event || typeof event !== "object") continue;

				const data =
					event.data && typeof event.data === "object"
						? (event.data as Record<string, unknown>)
						: undefined;
				const timestamp = toIsoTimestamp(event.timestamp, meta.fileMtime);

				switch (event.type) {
					case "session.start": {
						const context =
							data?.context && typeof data.context === "object"
								? (data.context as { cwd?: unknown })
								: undefined;
						const rawCwd =
							typeof context?.cwd === "string"
								? context.cwd
								: typeof data?.cwd === "string"
									? data.cwd
									: "";
						if (rawCwd) cwd = rawCwd;
						break;
					}
					case "user.message": {
						const text = extractContent(data);
						if (!text) break;
						messages.push({
							id: `${sessionId}-${messageIndex}`,
							parentUuid: null,
							type: "user",
							role: "user",
							content: text,
							hasToolUse: false,
							hasCode: false,
							thinking: null,
							timestamp,
						});
						messageIndex++;
						lastAssistantMessage = null;
						break;
					}
					case "assistant.message": {
						const text = extractContent(data);
						if (!text) {
							// An empty assistant record means its work lives entirely
							// in tool calls, which are separate events.
							lastAssistantMessage = null;
							break;
						}
						const message: ParsedMessage = {
							id: `${sessionId}-${messageIndex}`,
							parentUuid: null,
							type: "assistant",
							role: "assistant",
							content: text,
							hasToolUse: false,
							hasCode: text.includes("```"),
							thinking: null,
							timestamp,
						};
						messages.push(message);
						messageIndex++;
						lastAssistantMessage = message;
						break;
					}
					case "tool.execution_start": {
						// Tool arguments are deliberately not written into the body;
						// they are not conversation text.
						if (lastAssistantMessage) lastAssistantMessage.hasToolUse = true;
						break;
					}
					default:
						// tool.execution_complete, session.shutdown, session.info, ...
						break;
				}
			}
		} finally {
			lineReader.close();
		}

		const projectDir = cwd ?? meta.projectDir ?? "";
		return {
			id: sessionId,
			// Copilot CLI sessions have no title in the event log.
			slug: null,
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
		// Watch the local install only: watching `\\wsl.localhost` UNC paths is
		// slow and would start stopped distros. WSL sessions are picked up on the
		// next manual Import.
		return [resolve(getSessionStateDir(), "**", EVENTS_FILE)];
	},
};
