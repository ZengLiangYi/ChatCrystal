import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
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
import { readMaybeZstdFile } from "../zstd.js";

// =============================================
// Codex JSONL event types
// =============================================

interface CodexLine {
	timestamp?: string;
	type?: string; // 'session_meta' | 'response_item' | 'event_msg' | 'turn_context'
	payload?: Record<string, unknown>;
}

interface SessionMeta {
	id: string;
	cwd: string;
	originator?: string; // 'codex_cli' | 'codex_vscode'
	cli_version?: string;
	source?: string;
	git?: { commit_hash?: string; branch?: string };
}

// =============================================
// Session index for thread names (slug)
// =============================================

// The session index lives next to the sessions folder (`<codex home>/
// session_index.jsonl`), so every root — local or WSL — has its own index.
const sessionIndexes = new Map<string, Map<string, string>>();

/** Absolute path of the session index that belongs to a sessions root. */
function sessionIndexPath(sessionsRoot: string): string {
	return resolve(dirname(sessionsRoot), "session_index.jsonl");
}

async function loadSessionIndex(
	sessionsRoot: string,
): Promise<Map<string, string>> {
	const indexPath = sessionIndexPath(sessionsRoot);
	const cached = sessionIndexes.get(indexPath);
	if (cached) return cached;

	const index = new Map<string, string>();
	sessionIndexes.set(indexPath, index);
	if (!existsSync(indexPath)) return index;

	try {
		const content = await readFile(indexPath, "utf-8");
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line);
				if (entry.id && entry.thread_name) {
					index.set(entry.id, entry.thread_name);
				}
			} catch {
				// skip malformed lines
			}
		}
	} catch {
		// index file not readable
	}
	return index;
}

/**
 * Extract the actual user prompt from event_msg/user_message.
 * Codex VS Code prepends IDE context — extract the "My request for Codex:" part if present.
 */
function extractUserPrompt(message: string): string {
	const marker = "## My request for Codex:\n";
	const idx = message.indexOf(marker);
	if (idx >= 0) {
		return message.substring(idx + marker.length).trim();
	}
	return message.trim();
}

// =============================================
// Recursive file discovery
// =============================================

// Brief cache to avoid double walk during detect() → scan() cycle. Keyed by
// root: a WSL root is a separate tree from the local Codex home.
const rolloutCache = new Map<string, { result: string[]; expiry: number }>();

/** Codex homes hold live rollouts and archived ones in sibling folders. */
function rolloutRoots(dir: string): string[] {
	const roots = [dir];
	const archived = resolve(dirname(dir), "archived_sessions");
	if (existsSync(archived)) roots.push(archived);
	return roots;
}

function isRolloutFile(name: string): boolean {
	return (
		name.startsWith("rollout-") &&
		(name.endsWith(".jsonl") || name.endsWith(".jsonl.zst"))
	);
}

async function findRolloutFiles(dir: string): Promise<string[]> {
	const cached = rolloutCache.get(dir);
	if (cached && Date.now() < cached.expiry) {
		return cached.result;
	}
	const results: string[] = [];

	async function walk(d: string) {
		if (!existsSync(d)) return;
		const entries = await readdir(d, { withFileTypes: true });
		for (const entry of entries) {
			const full = resolve(d, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
			} else if (isRolloutFile(entry.name)) {
				results.push(full);
			}
		}
	}

	for (const root of rolloutRoots(dir)) {
		await walk(root);
	}

	rolloutCache.set(dir, { result: results, expiry: Date.now() + 5000 });
	return results;
}

/**
 * Session roots to scan: the local Codex CLI install plus every running WSL
 * distro home that has a `.codex/sessions` folder (`rootDir` will be one of
 * these, while sub-agent/archived folders are derived per root).
 */
function codexRoots(): string[] {
	return withWslRoots(appConfig.codexSessionsDir, ".codex/sessions");
}

// =============================================
// Extract project name from cwd path
// =============================================

function extractProjectName(cwd: string): string {
	// Normalize path separators
	const normalized = cwd.replace(/\\/g, "/");
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] || cwd;
}

// =============================================
// Rollout line reader (plain JSONL or zstd frames)
// =============================================

async function* readRolloutLines(filePath: string): AsyncGenerator<string> {
	if (filePath.endsWith(".zst")) {
		const text = await readMaybeZstdFile(filePath);
		for (const line of text.split("\n")) {
			if (line.trim()) yield line;
		}
		return;
	}
	const fileStream = createReadStream(filePath, { encoding: "utf-8" });
	const rl = createInterface({
		input: fileStream,
		crlfDelay: Number.POSITIVE_INFINITY,
	});
	for await (const line of rl) {
		yield line;
	}
}

/**
 * Extract the text of a Codex "item" content array (new event format). Block
 * type spelling varies ("text" for UserMessage, "Text" for AgentMessage), so
 * only the text field is read; encrypted blocks are ignored.
 */
function extractItemText(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object") {
			const text = (block as { text?: unknown }).text;
			if (typeof text === "string" && text.trim()) parts.push(text);
		}
	}
	return parts.join("\n").trim();
}

/** item_completed item types that represent a tool/action, not conversation. */
const TOOL_ITEM_TYPES = new Set([
	"CommandExecution",
	"FileChange",
	"SubAgentActivity",
	"CollabAgentToolCall",
	"ImageView",
	"Extension",
]);

// =============================================
// Codex CLI Adapter
// =============================================

export const codexAdapter: SourceAdapter = {
	name: "codex",
	displayName: "Codex CLI",
	parserVersion: "codex@4",

	async detect(): Promise<SourceInfo | null> {
		let conversationCount = 0;
		for (const root of codexRoots()) {
			try {
				conversationCount += (await findRolloutFiles(root)).length;
			} catch {
				// A WSL distro can stop while reading; keep the other roots' sessions.
			}
		}
		if (conversationCount === 0) return null;

		return {
			name: "codex",
			displayName: "Codex CLI",
			dataDir: appConfig.codexSessionsDir,
			conversationCount,
		};
	},

	async scan(): Promise<ConversationMeta[]> {
		// Parallel stat in batches (skip readFirstLine — extract sessionId from filename)
		const BATCH = 20;
		const metas: ConversationMeta[] = [];

		for (const root of codexRoots()) {
			let files: string[];
			try {
				files = await findRolloutFiles(root);
			} catch {
				// A WSL distro can stop while reading; keep the other roots' sessions.
				continue;
			}

			for (let i = 0; i < files.length; i += BATCH) {
				const batch = files.slice(i, i + BATCH);
				const results = await Promise.all(
					batch.map(async (filePath) => {
						try {
							const fileStat = await stat(filePath);
							if (fileStat.size < 50) return null;

							const name = basename(filePath).replace(/\.jsonl(\.zst)?$/, "");
							const match = name.match(
								/rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)/,
							);
							const sessionId = match ? match[1] : name;

							return {
								id: sessionId,
								source: "codex" as const,
								filePath,
								fileSize: fileStat.size,
								fileMtime: fileStat.mtime.toISOString(),
								// projectDir deferred to parse() — avoids reading file content in scan
								projectDir: "",
								rootDir: root,
							};
						} catch {
							return null;
						}
					}),
				);
				for (const r of results) {
					if (r) metas.push(r);
				}
			}
		}

		return metas;
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		const messages: ParsedMessage[] = [];
		let sessionId = meta.id;
		let cwd: string | null = null;
		let gitBranch: string | null = null;
		let slug: string | null = null;

		// Track which function_call IDs we've seen to mark hasToolUse on assistant messages
		let lastAssistantMsg: ParsedMessage | null = null;

		for await (const line of readRolloutLines(meta.filePath)) {
			if (!line.trim()) continue;

			let parsed: CodexLine;
			try {
				parsed = JSON.parse(line);
			} catch {
				continue;
			}

			const timestamp = parsed.timestamp || new Date().toISOString();
			const payload = parsed.payload;
			if (!payload) continue;

			const payloadType = payload.type as string;

			// --- session_meta: extract metadata ---
			if (parsed.type === "session_meta") {
				const meta = payload as unknown as SessionMeta;
				sessionId = meta.id || sessionId;
				cwd = meta.cwd || cwd;
				if (meta.git?.branch) gitBranch = meta.git.branch;
				continue;
			}

			// --- event_msg/user_message: user's actual prompt ---
			if (parsed.type === "event_msg" && payloadType === "user_message") {
				const rawMessage = (payload.message as string) || "";
				const userText = extractUserPrompt(rawMessage);

				if (!userText) continue;

				const msg: ParsedMessage = {
					id: randomUUID(),
					parentUuid: null,
					type: "user",
					role: "user",
					content: userText,
					hasToolUse: false,
					hasCode: userText.includes("```"),
					thinking: null,
					timestamp,
				};
				messages.push(msg);
				continue;
			}

			// --- event_msg/agent_message: assistant text response (older Codex) ---
			if (parsed.type === "event_msg" && payloadType === "agent_message") {
				const text = (payload.message as string) || "";
				if (!text.trim()) continue;
				if (lastAssistantMsg && lastAssistantMsg.content === text) continue;

				const msg: ParsedMessage = {
					id: randomUUID(),
					parentUuid: null,
					type: "assistant",
					role: "assistant",
					content: text,
					hasToolUse: false,
					hasCode: text.includes("```"),
					thinking: null,
					timestamp,
				};
				messages.push(msg);
				lastAssistantMsg = msg;
				continue;
			}

			// --- event_msg/item_completed: Codex >= 0.160 conversation items ---
			// Newer Codex builds stop emitting user_message/agent_message events
			// and report each finished conversation item instead, so the user and
			// assistant turns have to be read from here. Tool items mark the
			// preceding assistant reply as tool-using.
			if (parsed.type === "event_msg" && payloadType === "item_completed") {
				const item = payload.item as
					| { type?: string; content?: unknown }
					| undefined;
				const itemType = item?.type;

				if (itemType === "UserMessage") {
					const text = extractItemText(item?.content);
					if (!text) continue;

					const previous = messages[messages.length - 1];
					if (previous && previous.type === "user" && previous.content === text) {
						continue;
					}

					messages.push({
						id: randomUUID(),
						parentUuid: null,
						type: "user",
						role: "user",
						content: text,
						hasToolUse: false,
						hasCode: text.includes("```"),
						thinking: null,
						timestamp,
					});
					continue;
				}

				if (itemType === "AgentMessage") {
					const text = extractItemText(item?.content);
					if (!text) continue;
					if (lastAssistantMsg && lastAssistantMsg.content === text) continue;

					const msg: ParsedMessage = {
						id: randomUUID(),
						parentUuid: null,
						type: "assistant",
						role: "assistant",
						content: text,
						hasToolUse: false,
						hasCode: text.includes("```"),
						thinking: null,
						timestamp,
					};
					messages.push(msg);
					lastAssistantMsg = msg;
					continue;
				}

				if (itemType && TOOL_ITEM_TYPES.has(itemType) && lastAssistantMsg) {
					lastAssistantMsg.hasToolUse = true;
				}
				continue;
			}

			// --- response_item/message: full message objects ---
			if (parsed.type === "response_item" && payloadType === "message") {
				const role = payload.role as string;

				// Skip user role response_items — we use event_msg/user_message instead
				// (response_item user messages contain environment_context noise)
				if (role === "user" || role === "developer") continue;

				if (role === "assistant") {
					const contentBlocks = payload.content as
						| Array<{ type: string; text?: string }>
						| undefined;
					if (!contentBlocks) continue;

					const texts: string[] = [];
					for (const block of contentBlocks) {
						if (block.type === "output_text" && block.text) {
							texts.push(block.text);
						}
					}

					const fullText = texts.join("\n").trim();
					if (!fullText) continue;

					// Check if this duplicates the last agent_message (Codex often emits both)
					if (lastAssistantMsg && lastAssistantMsg.content === fullText) {
						continue; // Skip duplicate
					}

					const msg: ParsedMessage = {
						id: randomUUID(),
						parentUuid: null,
						type: "assistant",
						role: "assistant",
						content: fullText,
						hasToolUse: false,
						hasCode: fullText.includes("```"),
						thinking: null,
						timestamp,
					};
					messages.push(msg);
					lastAssistantMsg = msg;
				}
				continue;
			}

			// --- response_item/function_call: mark tool use on last assistant ---
			if (
				parsed.type === "response_item" &&
				(payloadType === "function_call" || payloadType === "custom_tool_call")
			) {
				if (lastAssistantMsg) {
					lastAssistantMsg.hasToolUse = true;
				}
			}

			// Skip: token_count, reasoning (encrypted), turn_context, task_started, etc.
		}

		// Load slug from session index; a WSL session's index lives in its root.
		const index = await loadSessionIndex(
			meta.rootDir ?? appConfig.codexSessionsDir,
		);
		slug = index.get(sessionId) || null;

		// Sort by timestamp
		messages.sort(
			(a, b) =>
				new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
		);

		const projectDir = meta.projectDir || cwd || "";
		const projectName = extractProjectName(projectDir);

		return {
			// Use the rollout file's own id: resumed threads share the original
			// thread id in session_meta, so header ids collide across files.
			id: meta.id,
			slug,
			source: "codex",
			projectDir,
			projectName,
			cwd,
			gitBranch,
			messages,
			firstMessageAt: messages[0]?.timestamp ?? new Date().toISOString(),
			lastMessageAt:
				messages[messages.length - 1]?.timestamp ?? new Date().toISOString(),
		};
	},

	watchPaths(): string[] {
		// Only the local root is watched: chokidar cannot watch UNC paths, and
		// touching a stopped WSL distro would start it. WSL sessions are picked
		// up by the next manual Import.
		const dir = appConfig.codexSessionsDir;
		return rolloutRoots(dir).map((root) => `${root}/**/*.jsonl*`);
	},
};
