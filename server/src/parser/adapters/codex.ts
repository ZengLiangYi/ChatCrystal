import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
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

let sessionIndex: Map<string, string> | null = null;

async function loadSessionIndex(): Promise<Map<string, string>> {
	if (sessionIndex) return sessionIndex;
	sessionIndex = new Map();

	const indexPath = resolve(homedir(), ".codex", "session_index.jsonl");
	if (!existsSync(indexPath)) return sessionIndex;

	try {
		const content = await readFile(indexPath, "utf-8");
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line);
				if (entry.id && entry.thread_name) {
					sessionIndex.set(entry.id, entry.thread_name);
				}
			} catch {
				// skip malformed lines
			}
		}
	} catch {
		// index file not readable
	}
	return sessionIndex;
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

async function findRolloutFiles(dir: string): Promise<string[]> {
	const results: string[] = [];
	if (!existsSync(dir)) return results;

	async function walk(d: string) {
		const entries = await readdir(d, { withFileTypes: true });
		for (const entry of entries) {
			const full = resolve(d, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
			} else if (
				entry.name.startsWith("rollout-") &&
				entry.name.endsWith(".jsonl")
			) {
				results.push(full);
			}
		}
	}

	await walk(dir);
	return results;
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
// Codex CLI Adapter
// =============================================

export const codexAdapter: SourceAdapter = {
	name: "codex",
	displayName: "Codex CLI",

	async detect(): Promise<SourceInfo | null> {
		const dir = appConfig.codexSessionsDir;
		if (!existsSync(dir)) return null;

		try {
			const files = await findRolloutFiles(dir);
			if (files.length === 0) return null;

			return {
				name: "codex",
				displayName: "Codex CLI",
				dataDir: dir,
				conversationCount: files.length,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		const dir = appConfig.codexSessionsDir;
		if (!existsSync(dir)) return [];

		const files = await findRolloutFiles(dir);
		const metas: ConversationMeta[] = [];

		for (const filePath of files) {
			try {
				const fileStat = await stat(filePath);

				// Skip very small files
				if (fileStat.size < 50) continue;

				// Read first line to get session_meta for id and cwd
				let sessionId: string | null = null;
				let projectDir = "";

				const firstLine = await readFirstLine(filePath);
				if (firstLine) {
					try {
						const parsed = JSON.parse(firstLine) as CodexLine;
						if (parsed.type === "session_meta" && parsed.payload) {
							const meta = parsed.payload as unknown as SessionMeta;
							sessionId = meta.id;
							projectDir = meta.cwd || "";
						}
					} catch {
						// malformed first line
					}
				}

				// Fallback: extract session id from filename
				// Format: rollout-2025-10-01T21-43-32-0199a003-9348-72f3-82b7-fe1435ce085b.jsonl
				if (!sessionId) {
					const name = basename(filePath, ".jsonl");
					// The UUID is after the timestamp part (rollout-YYYY-MM-DDTHH-MM-SS-)
					const match = name.match(
						/rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)/,
					);
					sessionId = match ? match[1] : name;
				}

				metas.push({
					id: sessionId,
					source: "codex",
					filePath,
					fileSize: fileStat.size,
					fileMtime: fileStat.mtime.toISOString(),
					projectDir,
				});
			} catch {
				// Skip files we can't stat
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

		const fileStream = createReadStream(meta.filePath, { encoding: "utf-8" });
		const rl = createInterface({
			input: fileStream,
			crlfDelay: Number.POSITIVE_INFINITY,
		});

		// Track which function_call IDs we've seen to mark hasToolUse on assistant messages
		let lastAssistantMsg: ParsedMessage | null = null;

		for await (const line of rl) {
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

			// --- event_msg/agent_message: assistant text response ---
			if (parsed.type === "event_msg" && payloadType === "agent_message") {
				const text = (payload.message as string) || "";
				if (!text.trim()) continue;

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

		// Load slug from session index
		const index = await loadSessionIndex();
		slug = index.get(sessionId) || null;

		// Sort by timestamp
		messages.sort(
			(a, b) =>
				new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
		);

		const projectDir = meta.projectDir || cwd || "";
		const projectName = extractProjectName(projectDir);

		return {
			id: sessionId,
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
};

// =============================================
// Helper: read first line of a file
// =============================================

async function readFirstLine(filePath: string): Promise<string | null> {
	const stream = createReadStream(filePath, { encoding: "utf-8" });
	const rl = createInterface({
		input: stream,
		crlfDelay: Number.POSITIVE_INFINITY,
	});

	for await (const line of rl) {
		rl.close();
		stream.destroy();
		return line;
	}
	return null;
}
