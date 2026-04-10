import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { resolve } from "node:path";
import type {
	ConversationMeta,
	ParsedConversation,
	ParsedMessage,
	SourceInfo,
} from "@chatcrystal/shared";
import { appConfig } from "../../config.js";
import type { SourceAdapter } from "../adapter.js";
import { openVscdb } from "../vscdb.js";

// =============================================
// Platform-specific paths
// =============================================

function getTraeBasePath(): string {
	if (appConfig.traeDataDir) return appConfig.traeDataDir;

	const p = platform();
	if (p === "win32") {
		return resolve(process.env.APPDATA || "", "Trae", "User");
	} else if (p === "darwin") {
		return resolve(homedir(), "Library", "Application Support", "Trae", "User");
	} else {
		return resolve(homedir(), ".config", "Trae", "User");
	}
}

function getWorkspaceStoragePath(): string {
	return resolve(getTraeBasePath(), "workspaceStorage");
}

// =============================================
// Trae chat storage types
// =============================================

interface TraeSession {
	sessionId: string;
	createdAt: number; // epoch ms
	updatedAt: number; // epoch ms
	messages: TraeMessage[];
}

interface TraeMessage {
	role: "user" | "assistant" | "system";
	content: string;
	sessionId: string;
	turnIndex: number;
	timestamp?: number; // epoch ms
	status?: string;
	agentType?: string;
	agentMessageType?: string;
	agentMessageId?: string;
	turnId?: string;
	modelInfo?: {
		config_name?: string;
		display_model_name?: string;
	};
	agentTaskContent?: {
		proposal?: string;
		proposalReasoningContent?: string;
		guideline?: {
			thought?: string;
			planItems?: TraePlanItem[];
		};
	};
}

interface TraePlanItem {
	thought?: string;
	toolName?: string;
	reasoningContent?: string;
}

interface TraeStorage {
	list: TraeSession[];
	currentSessionId?: string;
}

// =============================================
// Workspace scanning
// =============================================

interface WorkspaceInfo {
	hash: string;
	folder: string;
	dbPath: string;
	sessions: Array<{
		sessionId: string;
		messageCount: number;
		updatedAt: number;
	}>;
}

async function scanWorkspaces(): Promise<WorkspaceInfo[]> {
	const wsStoragePath = getWorkspaceStoragePath();
	if (!existsSync(wsStoragePath)) return [];

	const entries = await readdir(wsStoragePath);
	const results: WorkspaceInfo[] = [];

	for (const hash of entries) {
		const wsDir = resolve(wsStoragePath, hash);
		const wsJsonPath = resolve(wsDir, "workspace.json");
		const dbPath = resolve(wsDir, "state.vscdb");

		if (!existsSync(wsJsonPath) || !existsSync(dbPath)) continue;

		try {
			const wsJson = JSON.parse(await readFile(wsJsonPath, "utf-8"));
			const rawFolder = (wsJson.folder as string) || "";
			const folder = decodeURIComponent(rawFolder.replace(/^file:\/\/\//, ""));

			const db = await openVscdb(dbPath);
			if (!db) continue;

			try {
				const result = db.exec(
					"SELECT value FROM ItemTable WHERE [key] = 'memento/icube-ai-agent-storage'",
				);

				if (result.length > 0 && result[0].values.length > 0) {
					const raw = result[0].values[0][0];
					const str =
						typeof raw === "string"
							? raw
							: Buffer.from(raw as Uint8Array).toString("utf8");
					const data = JSON.parse(str) as TraeStorage;

					if (data.list && data.list.length > 0) {
						const sessions = data.list
							.filter((s) => s.messages && s.messages.length > 0)
							.map((s) => ({
								sessionId: s.sessionId,
								messageCount: s.messages.length,
								updatedAt: s.updatedAt || s.createdAt,
							}));

						if (sessions.length > 0) {
							results.push({ hash, folder, dbPath, sessions });
						}
					}
				}
			} finally {
				db.close();
			}
		} catch {
			// Skip problematic workspaces
		}
	}

	return results;
}

// =============================================
// Content extraction
// =============================================

/**
 * Extract meaningful content from a Trae assistant message.
 * Trae's agent (SOLO Builder) stores responses in agentTaskContent
 * with tool steps; the final step (toolName: "finish") contains the summary.
 * Reasoning content from proposalReasoningContent and per-step reasoningContent
 * is extracted as thinking.
 */
function extractAssistantContent(msg: TraeMessage): {
	text: string;
	thinking: string | null;
} {
	// Direct content is preferred
	if (msg.content?.trim()) {
		return { text: msg.content.trim(), thinking: null };
	}

	// Fall back to agentTaskContent
	const task = msg.agentTaskContent;
	if (!task) return { text: "", thinking: null };

	const parts: string[] = [];
	const thinkingParts: string[] = [];

	// Proposal text
	if (task.proposal) parts.push(task.proposal);

	// Top-level reasoning content
	if (task.proposalReasoningContent) {
		thinkingParts.push(task.proposalReasoningContent);
	}

	// Guideline thoughts from plan items
	if (task.guideline?.planItems) {
		for (const item of task.guideline.planItems) {
			// Collect per-step reasoning
			if (item.reasoningContent) {
				thinkingParts.push(item.reasoningContent);
			}

			if (item.toolName === "finish" && item.thought) {
				// The "finish" step usually has the complete response
				parts.push(item.thought);
			}
		}
	}

	// If no finish step found, try the guideline thought
	if (parts.length === 0 && task.guideline?.thought) {
		parts.push(task.guideline.thought);
	}

	return {
		text: parts.join("\n\n").trim(),
		thinking: thinkingParts.length > 0 ? thinkingParts.join("\n") : null,
	};
}

/**
 * Detect if assistant message used tools (has planItems with non-finish tools).
 */
function hasToolUse(msg: TraeMessage): boolean {
	const items = msg.agentTaskContent?.guideline?.planItems;
	if (!items || items.length === 0) return false;
	return items.some((item) => item.toolName && item.toolName !== "finish");
}

// =============================================
// Project name extraction
// =============================================

function extractProjectName(folder: string): string {
	const normalized = folder.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] || folder;
}

// =============================================
// Exported helper for watcher
// =============================================

export function getTraeWatchPaths(): string[] {
	const wsStoragePath = getWorkspaceStoragePath();
	if (!existsSync(wsStoragePath)) return [];
	return [`${wsStoragePath}/*/state.vscdb`];
}

// =============================================
// Trae Adapter
// =============================================

export const traeAdapter: SourceAdapter = {
	name: "trae",
	displayName: "Trae",

	async detect(): Promise<SourceInfo | null> {
		try {
			const workspaces = await scanWorkspaces();
			const totalSessions = workspaces.reduce(
				(sum, ws) => sum + ws.sessions.length,
				0,
			);

			if (totalSessions === 0) return null;

			return {
				name: "trae",
				displayName: "Trae",
				dataDir: getTraeBasePath(),
				conversationCount: totalSessions,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		const workspaces = await scanWorkspaces();
		const metas: ConversationMeta[] = [];

		for (const ws of workspaces) {
			const dbStat = await stat(ws.dbPath);

			for (const session of ws.sessions) {
				const sessionMtime = session.updatedAt
					? new Date(session.updatedAt).toISOString()
					: dbStat.mtime.toISOString();

				metas.push({
					id: session.sessionId,
					source: "trae",
					filePath: ws.dbPath,
					fileSize: dbStat.size,
					fileMtime: sessionMtime,
					projectDir: ws.folder,
				});
			}
		}

		return metas;
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		const db = await openVscdb(meta.filePath);
		if (!db) return emptyConversation(meta);

		try {
			const result = db.exec(
				"SELECT value FROM ItemTable WHERE [key] = 'memento/icube-ai-agent-storage'",
			);

			if (!result.length || !result[0].values.length) {
				return emptyConversation(meta);
			}

			const raw = result[0].values[0][0];
			const str =
				typeof raw === "string"
					? raw
					: Buffer.from(raw as Uint8Array).toString("utf8");
			const data = JSON.parse(str) as TraeStorage;

			const session = data.list.find((s) => s.sessionId === meta.id);
			if (!session?.messages?.length) {
				return emptyConversation(meta);
			}

			const messages: ParsedMessage[] = [];

			// Sort by turnIndex to preserve conversation order
			// (timestamps on assistant messages can be unreliable)
			const sorted = [...session.messages].sort(
				(a, b) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0),
			);

			// Use a monotonic counter for synthetic ordering
			let orderMs = session.createdAt;

			for (const msg of sorted) {
				const role = msg.role;
				if (role !== "user" && role !== "assistant") continue;

				let content: string;
				let thinking: string | null = null;
				let toolUse = false;

				if (role === "user") {
					content = (msg.content || "").trim();
				} else {
					const extracted = extractAssistantContent(msg);
					content = extracted.text;
					thinking = extracted.thinking;
					toolUse = hasToolUse(msg);
				}

				// Skip empty messages
				if (!content && !thinking) continue;

				// Use real timestamp if available and sane, else synthetic
				const realTs = msg.timestamp ? msg.timestamp : 0;
				const ts = realTs > orderMs ? realTs : orderMs;
				orderMs = ts + 1;

				messages.push({
					id: msg.agentMessageId || msg.turnId || `${meta.id}-${msg.turnIndex}`,
					parentUuid: null,
					type: role,
					role,
					content,
					hasToolUse: toolUse,
					hasCode: content.includes("```"),
					thinking,
					timestamp: new Date(ts).toISOString(),
				});
			}

			const projectName = extractProjectName(meta.projectDir);

			return {
				id: meta.id,
				slug: null,
				source: "trae",
				projectDir: meta.projectDir,
				projectName,
				cwd: meta.projectDir || null,
				gitBranch: null,
				messages,
				firstMessageAt: messages[0]?.timestamp ?? new Date().toISOString(),
				lastMessageAt:
					messages[messages.length - 1]?.timestamp ?? new Date().toISOString(),
			};
		} finally {
			db.close();
		}
	},
};

function emptyConversation(meta: ConversationMeta): ParsedConversation {
	return {
		id: meta.id,
		slug: null,
		source: "trae",
		projectDir: meta.projectDir,
		projectName: extractProjectName(meta.projectDir),
		cwd: meta.projectDir || null,
		gitBranch: null,
		messages: [],
		firstMessageAt: new Date().toISOString(),
		lastMessageAt: new Date().toISOString(),
	};
}
