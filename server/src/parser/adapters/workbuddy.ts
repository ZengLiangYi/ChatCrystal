import { existsSync, type Dirent } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
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

// =============================================
// WorkBuddy / WorkBuddy AI session format
// =============================================
//
// <workbuddyDataDir>/projects/<encoded-project>/<sessionId>.jsonl
// <workbuddyAiDataDir>/projects/<encoded-project>/<sessionId>.jsonl
//
// Both the China build (~/.workbuddy) and the international build
// (~/.workbuddy-ai) keep sessions in the same layout and are merged into one
// source. Only the session files directly below a project folder are
// conversations; <sessionId>/subagents/*.jsonl belong to a session's subagents
// and are skipped.
//
// Each build can also run inside a WSL distro (same relative folders under the
// distro user's home), so both builds' WSL counterparts are scanned too and
// every scanned meta records the root it came from.
//
// Each line is an OpenAI Agents SDK item with a type:
//   session-meta      {sessionId, timestamp, meta} (repeated)
//   message           {id, timestamp, role, content: [{type, text}]}
//   reasoning         {rawContent: [{type: 'reasoning_text', text}]}
//   function_call     {name, arguments} — marks the previous reply as tool-using
//   function_call_result
//   ai-title          {aiTitle} / custom-title {customTitle}
//   credit-usage, file-history-snapshot, ... (ignored)

/** Read enough of a session file's head to find its sessionId. */
async function readSessionIdFromHead(filePath: string): Promise<string | null> {
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		handle = await open(filePath, "r");
		const buffer = Buffer.alloc(16 * 1024);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const head = buffer.subarray(0, bytesRead).toString("utf8");
		const match = /"sessionId"\s*:\s*"([^"]+)"/.exec(head);
		const sessionId = match?.[1]?.trim();
		return sessionId || null;
	} catch {
		return null;
	} finally {
		await handle?.close().catch(() => {
			// best-effort close; nothing useful to do here
		});
	}
}

/** Distro-home-relative locations of the two WorkBuddy builds. */
const WORKBUDDY_WSL_RELATIVE = ".workbuddy";
const WORKBUDDY_AI_WSL_RELATIVE = ".workbuddy-ai";

/** The two builds' configured (Windows-local) roots, resolved and de-duplicated. */
function configuredRoots(): string[] {
	const roots: string[] = [];
	const seen = new Set<string>();
	for (const configured of [
		appConfig.workbuddyDataDir,
		appConfig.workbuddyAiDataDir,
	]) {
		const root = (configured ?? "").trim();
		if (!root) continue;
		const absolute = resolve(root);
		const key =
			process.platform === "win32" ? absolute.toLowerCase() : absolute;
		if (seen.has(key)) continue;
		seen.add(key);
		roots.push(absolute);
	}
	return roots;
}

/**
 * All data roots to scan: each build's Windows-local root plus its WSL
 * counterparts, merged and de-duplicated (`resolve` can make two configured
 * folders collapse into one root).
 */
function dataRoots(): string[] {
	const roots: string[] = [];
	const seen = new Set<string>();
	for (const [configured, wslRelative] of [
		[appConfig.workbuddyDataDir, WORKBUDDY_WSL_RELATIVE],
		[appConfig.workbuddyAiDataDir, WORKBUDDY_AI_WSL_RELATIVE],
	] as const) {
		const primary = (configured ?? "").trim();
		if (!primary) continue;
		for (const root of withWslRoots(resolve(primary), wslRelative)) {
			const absolute = resolve(root);
			const key =
				process.platform === "win32" ? absolute.toLowerCase() : absolute;
			if (seen.has(key)) continue;
			seen.add(key);
			roots.push(absolute);
		}
	}
	return roots;
}

interface WorkBuddySessionFile {
	id: string;
	filePath: string;
	fileSize: number;
	fileMtime: string;
	/** The data root (Windows-local or WSL) the session file was found under. */
	rootDir: string;
}

/**
 * Collect the session files of every configured data root. Reads directory
 * entries, stats and a small head of each file only — message content is parsed
 * lazily by `parse()`. The head read keeps the scanned id equal to the
 * sessionId written inside the file (normally they are the same as the file
 * name), so import deduplication by id stays stable.
 */
async function collectSessionFiles(): Promise<WorkBuddySessionFile[]> {
	const sessions: WorkBuddySessionFile[] = [];

	for (const root of dataRoots()) {
		const projectsDir = resolve(root, "projects");
		if (!existsSync(projectsDir)) continue;

		let projectEntries: Dirent[];
		try {
			projectEntries = await readdir(projectsDir, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const projectEntry of projectEntries) {
			if (!projectEntry.isDirectory() || projectEntry.name.startsWith(".")) {
				continue;
			}
			const projectPath = resolve(projectsDir, projectEntry.name);

			let files: Dirent[];
			try {
				files = await readdir(projectPath, { withFileTypes: true });
			} catch {
				continue;
			}

			for (const file of files) {
				if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
				if (file.name.startsWith(".")) continue;

				const filePath = resolve(projectPath, file.name);
				let fileStat: Awaited<ReturnType<typeof stat>>;
				try {
					fileStat = await stat(filePath);
				} catch {
					continue;
				}
				if (fileStat.size === 0) continue;

				const fileBaseName = file.name.slice(0, -".jsonl".length);
				const sessionId = await readSessionIdFromHead(filePath);

				sessions.push({
					id: sessionId || fileBaseName,
					filePath,
					fileSize: fileStat.size,
					fileMtime: fileStat.mtime.toISOString(),
					rootDir: root,
				});
			}
		}
	}

	// The two builds can be configured to overlapping roots; list each file once.
	const seen = new Set<string>();
	return sessions.filter((session) => {
		const absolute = resolve(session.filePath);
		const key =
			process.platform === "win32" ? absolute.toLowerCase() : absolute;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

// =============================================
// Content helpers
// =============================================

const SYSTEM_REMINDER_PATTERN =
	/<system-reminder(?:\s[^>]*)?>[\s\S]*?<\/system-reminder>/g;
const USER_QUERY_PATTERN = /<user_query>([\s\S]*?)<\/user_query>/g;
/** A line naming the UI scene the prompt was sent from, e.g. `@scene:chat`. */
const SCENE_LINE_PATTERN = /^\s*@[\w.-]+:\S*\s*$/gm;

interface WorkBuddyBlock {
	type?: string;
	text?: string;
}

interface WorkBuddyRecord {
	type?: string;
	id?: string;
	timestamp?: number;
	role?: string;
	cwd?: string;
	sessionId?: string;
	content?: string | WorkBuddyBlock[];
	rawContent?: WorkBuddyBlock[];
	aiTitle?: string;
	customTitle?: string;
}

function blocksOf(content: string | WorkBuddyBlock[] | undefined): WorkBuddyBlock[] {
	if (typeof content === "string") return [{ type: "text", text: content }];
	return Array.isArray(content) ? content : [];
}

function blockTexts(
	content: string | WorkBuddyBlock[] | undefined,
	acceptedTypes: ReadonlySet<string>,
): string {
	return blocksOf(content)
		.filter(
			(block) =>
				typeof block?.text === "string" &&
				(typeof block.type !== "string" || acceptedTypes.has(block.type)),
		)
		.map((block) => block.text as string)
		.join("\n");
}

/**
 * The words a person typed into a user message. WorkBuddy injects context into
 * the same block: `<system-reminder …>` sections, `@scene:` prefixes and, for
 * framework notices (subagent reports, compaction summaries), whole records
 * that are XML-tagged but not conversation. The actual prompt usually lives in
 * a `<user_query>` wrapper.
 */
function extractUserText(content: string | WorkBuddyBlock[] | undefined): string {
	const parts: string[] = [];

	for (const block of blocksOf(content)) {
		if (typeof block?.text !== "string") continue;
		const raw = block.text;
		if (!raw.trim()) continue;

		const queries: string[] = [];
		for (const match of raw.matchAll(USER_QUERY_PATTERN)) {
			const query = (match[1] ?? "").trim();
			if (query) queries.push(query);
		}

		if (queries.length > 0) {
			parts.push(queries.join("\n"));
			continue;
		}

		const cleaned = raw
			.replace(SYSTEM_REMINDER_PATTERN, "")
			.replace(SCENE_LINE_PATTERN, "")
			.trim();
		// What is left starting with a tag is a framework notice, not a prompt.
		if (!cleaned || cleaned.startsWith("<")) continue;
		parts.push(cleaned);
	}

	return parts.join("\n").trim();
}

function extractAssistantText(content: string | WorkBuddyBlock[] | undefined): string {
	return blockTexts(
		content,
		new Set(["output_text", "text", "input_text"]),
	).trim();
}

function extractReasoningText(record: WorkBuddyRecord): string {
	return blockTexts(record.rawContent, new Set(["reasoning_text", "text"])).trim();
}

/** Last path segment, accepting both Windows and POSIX separators. */
function extractProjectName(path: string): string {
	const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? "";
}

function recordTimestamp(record: WorkBuddyRecord, fallbackIso: string): string {
	if (typeof record.timestamp === "number" && Number.isFinite(record.timestamp)) {
		return new Date(record.timestamp).toISOString();
	}
	return fallbackIso;
}

// =============================================
// WorkBuddy Adapter
// =============================================

export const workbuddyAdapter: SourceAdapter = {
	name: "workbuddy",
	displayName: "WorkBuddy",
	parserVersion: "workbuddy@2",

	async detect(): Promise<SourceInfo | null> {
		try {
			const sessions = await collectSessionFiles();
			if (sessions.length === 0) return null;

			// Report a Windows-local root (primary build first, AI build as the
			// fallback) even when the only sessions found are inside WSL.
			const roots = configuredRoots();
			const dataDir = roots.find((root) => existsSync(root)) ?? roots[0] ?? "";
			if (!dataDir) return null;

			return {
				name: "workbuddy",
				displayName: "WorkBuddy",
				dataDir,
				conversationCount: sessions.length,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		let sessions: WorkBuddySessionFile[];
		try {
			sessions = await collectSessionFiles();
		} catch {
			return [];
		}

		return sessions.map((session) => ({
			id: session.id,
			source: "workbuddy",
			filePath: session.filePath,
			fileSize: session.fileSize,
			fileMtime: session.fileMtime,
			// cwd comes from the records in parse().
			projectDir: "",
			rootDir: session.rootDir,
		}));
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		const messages: ParsedMessage[] = [];
		let cwd: string | null = null;
		let sessionId: string | null = null;
		let aiTitle: string | null = null;
		let customTitle: string | null = null;
		let lastAssistantMessage: ParsedMessage | null = null;
		let pendingReasoning: string[] = [];

		let fileText = "";
		try {
			fileText = await readFile(meta.filePath, "utf8");
		} catch {
			fileText = "";
		}

		const fileMtimeIso = meta.fileMtime || new Date().toISOString();
		const conversationId = meta.id;
		let userIndex = 0;
		let assistantIndex = 0;

		for (const line of fileText.split("\n")) {
			if (!line.trim()) continue;

			let record: WorkBuddyRecord;
			try {
				record = JSON.parse(line) as WorkBuddyRecord;
			} catch {
				continue; // Truncated / malformed line
			}
			if (!record || typeof record !== "object") continue;

			if (!cwd && typeof record.cwd === "string" && record.cwd.trim()) {
				cwd = record.cwd.trim();
			}
			if (
				!sessionId &&
				typeof record.sessionId === "string" &&
				record.sessionId.trim()
			) {
				sessionId = record.sessionId.trim();
			}

			switch (record.type) {
				case "message": {
					if (record.role === "user") {
						const text = extractUserText(record.content);
						if (!text) break;

						messages.push({
							id: record.id || `${conversationId}-u-${userIndex}`,
							parentUuid: null,
							type: "user",
							role: "user",
							content: text,
							hasToolUse: false,
							hasCode: text.includes("```"),
							thinking: null,
							timestamp: recordTimestamp(record, fileMtimeIso),
						});
						userIndex++;
						break;
					}

					if (record.role === "assistant") {
						const text = extractAssistantText(record.content);
						const thinking = pendingReasoning.join("\n");
						pendingReasoning = [];
						if (!text && !thinking) break;

						const message: ParsedMessage = {
							id: record.id || `${conversationId}-a-${assistantIndex}`,
							parentUuid: null,
							type: "assistant",
							role: "assistant",
							content: text,
							hasToolUse: false,
							hasCode: text.includes("```"),
							thinking: thinking || null,
							timestamp: recordTimestamp(record, fileMtimeIso),
						};
						messages.push(message);
						lastAssistantMessage = message;
						assistantIndex++;
					}
					break;
				}

				case "reasoning": {
					const text = extractReasoningText(record);
					if (text) pendingReasoning.push(text);
					break;
				}

				case "function_call": {
					// Calls are separate items; they belong to the reply above them.
					if (lastAssistantMessage) lastAssistantMessage.hasToolUse = true;
					break;
				}

				case "ai-title": {
					const title =
						typeof record.aiTitle === "string" ? record.aiTitle.trim() : "";
					if (title) aiTitle = title;
					break;
				}

				case "custom-title": {
					const title =
						typeof record.customTitle === "string"
							? record.customTitle.trim()
							: "";
					if (title) customTitle = title;
					break;
				}

				// function_call_result, credit-usage, file-history-snapshot,
				// session-meta, ... are bookkeeping, not conversation.
				default:
					break;
			}
		}

		// A reasoning item written after its reply (rare) still belongs to it.
		if (pendingReasoning.length > 0 && lastAssistantMessage) {
			const tail = pendingReasoning.join("\n");
			lastAssistantMessage.thinking = lastAssistantMessage.thinking
				? `${lastAssistantMessage.thinking}\n${tail}`
				: tail;
		}

		messages.sort(
			(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
		);

		const projectDir = cwd || meta.projectDir || "";
		return {
			id: sessionId || meta.id,
			slug: customTitle || aiTitle || null,
			source: "workbuddy",
			projectDir,
			projectName: extractProjectName(projectDir),
			cwd: cwd || null,
			gitBranch: null,
			messages,
			firstMessageAt: messages[0]?.timestamp ?? fileMtimeIso,
			lastMessageAt:
				messages[messages.length - 1]?.timestamp ?? fileMtimeIso,
		};
	},

	watchPaths(): string[] {
		// Only the Windows-local builds: `\\wsl.localhost` paths are slow and may
		// start a stopped distro. WSL conversations sync on the next manual Import.
		return configuredRoots().map((root) =>
			resolve(root, "**/projects/**/*.jsonl"),
		);
	},
};
