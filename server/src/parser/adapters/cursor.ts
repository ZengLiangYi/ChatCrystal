import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { resolve } from "node:path";
import type {
	ConversationMeta,
	ParsedConversation,
	ParsedMessage,
	SourceInfo,
} from "@chatcrystal/shared";
import initSqlJs, { type Database } from "sql.js";
import { appConfig } from "../../config.js";
import type { SourceAdapter } from "../adapter.js";

// =============================================
// Platform-specific paths
// =============================================

function getCursorBasePath(): string {
	if (appConfig.cursorDataDir) return appConfig.cursorDataDir;

	const p = platform();
	if (p === "win32") {
		return resolve(process.env.APPDATA || "", "Cursor", "User");
	} else if (p === "darwin") {
		return resolve(
			homedir(),
			"Library",
			"Application Support",
			"Cursor",
			"User",
		);
	} else {
		return resolve(homedir(), ".config", "Cursor", "User");
	}
}

function getGlobalVscdbPath(): string {
	return resolve(getCursorBasePath(), "globalStorage", "state.vscdb");
}

function getWorkspaceStoragePath(): string {
	return resolve(getCursorBasePath(), "workspaceStorage");
}

/** Exported for watcher to use */
export function getCursorGlobalVscdbPath(): string | null {
	const p = getGlobalVscdbPath();
	return existsSync(p) ? p : null;
}

// =============================================
// Open SQLite DB safely via sql.js (from buffer, read-only)
// =============================================

let sqlJsInstance: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function getSqlJs() {
	if (!sqlJsInstance) {
		sqlJsInstance = await initSqlJs();
	}
	return sqlJsInstance;
}

async function openVscdb(dbPath: string): Promise<Database | null> {
	try {
		const SQL = await getSqlJs();
		const buf = readFileSync(dbPath);
		return new SQL.Database(buf);
	} catch {
		// File locked or corrupted — retry once after short delay
		try {
			await new Promise((r) => setTimeout(r, 500));
			const SQL = await getSqlJs();
			const buf = readFileSync(dbPath);
			return new SQL.Database(buf);
		} catch {
			return null;
		}
	}
}

// =============================================
// Composer metadata from workspace DB
// =============================================

interface ComposerHead {
	type: string; // 'head'
	composerId: string;
	createdAt: number; // epoch ms
	unifiedMode?: string;
	name?: string;
	lastUpdatedAt?: number;
}

interface ComposerData {
	allComposers: ComposerHead[];
}

interface WorkspaceInfo {
	hash: string;
	folder: string; // decoded project path
	composers: ComposerHead[];
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
			// Read workspace folder path
			const wsJson = JSON.parse(await readFile(wsJsonPath, "utf-8"));
			const rawFolder = (wsJson.folder as string) || "";
			const folder = decodeURIComponent(rawFolder.replace(/^file:\/\/\//, ""));

			// Read composer data from workspace DB
			const db = await openVscdb(dbPath);
			if (!db) continue;

			try {
				const result = db.exec(
					"SELECT value FROM ItemTable WHERE [key] = 'composer.composerData'",
				);

				if (result.length > 0 && result[0].values.length > 0) {
					const data = JSON.parse(
						result[0].values[0][0] as string,
					) as ComposerData;
					if (data.allComposers && data.allComposers.length > 0) {
						results.push({
							hash,
							folder,
							composers: data.allComposers,
						});
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
// Project name extraction
// =============================================

function extractProjectName(folder: string): string {
	const normalized = folder.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] || folder;
}

// =============================================
// Bubble data parsing
// =============================================

interface BubbleData {
	_v: number;
	type: number; // 1 = user, 2 = assistant
	text?: string;
	createdAt?: string; // ISO string
	isAgentic?: boolean;
	toolResults?: unknown[];
	suggestedCodeBlocks?: unknown[];
	codeBlocks?: unknown[];
	allThinkingBlocks?: Array<{ thinking?: string; text?: string }>;
	thinking?: string;
	bubbleId?: string;
}

// =============================================
// Cursor Adapter
// =============================================

export const cursorAdapter: SourceAdapter = {
	name: "cursor",
	displayName: "Cursor",

	async detect(): Promise<SourceInfo | null> {
		const globalDbPath = getGlobalVscdbPath();
		if (!existsSync(globalDbPath)) return null;

		try {
			const workspaces = await scanWorkspaces();
			const totalComposers = workspaces.reduce(
				(sum, ws) => sum + ws.composers.length,
				0,
			);

			if (totalComposers === 0) return null;

			return {
				name: "cursor",
				displayName: "Cursor",
				dataDir: getCursorBasePath(),
				conversationCount: totalComposers,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		const globalDbPath = getGlobalVscdbPath();
		if (!existsSync(globalDbPath)) return [];

		const workspaces = await scanWorkspaces();
		const globalStat = await stat(globalDbPath);
		const metas: ConversationMeta[] = [];

		for (const ws of workspaces) {
			for (const composer of ws.composers) {
				// Use composer's createdAt as fileMtime for change detection
				// (more precise than global DB mtime since many composers share one DB)
				const composerMtime = composer.createdAt
					? new Date(composer.createdAt).toISOString()
					: globalStat.mtime.toISOString();

				metas.push({
					id: composer.composerId,
					source: "cursor",
					filePath: globalDbPath,
					fileSize: globalStat.size,
					fileMtime: composerMtime,
					projectDir: ws.folder,
				});
			}
		}

		return metas;
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		const globalDbPath = getGlobalVscdbPath();
		const messages: ParsedMessage[] = [];
		const slug: string | null = null;

		const db = await openVscdb(globalDbPath);
		if (!db) {
			return emptyConversation(meta);
		}

		try {
			// Query all bubbles for this composer
			const composerId = meta.id;
			const result = db.exec(
				`SELECT [key], value FROM cursorDiskKV WHERE [key] LIKE 'bubbleId:${composerId}:%'`,
			);

			if (!result.length || !result[0].values.length) {
				return emptyConversation(meta);
			}

			for (const row of result[0].values) {
				const raw = row[1] as string;
				let bubble: BubbleData;
				try {
					bubble = JSON.parse(raw);
				} catch {
					continue;
				}

				// Check schema version
				if (bubble._v && bubble._v > 3) {
					console.warn(`[Cursor] Unknown bubble schema version: ${bubble._v}`);
				}

				const msgType: "user" | "assistant" =
					bubble.type === 1 ? "user" : "assistant";
				const text = (bubble.text || "").trim();

				// Skip empty assistant bubbles (streaming intermediates)
				if (msgType === "assistant" && !text) continue;

				// Detect features
				const hasToolUse =
					(bubble.toolResults && bubble.toolResults.length > 0) ||
					bubble.isAgentic === true;
				const hasCode =
					text.includes("```") ||
					(bubble.codeBlocks && bubble.codeBlocks.length > 0) ||
					(bubble.suggestedCodeBlocks && bubble.suggestedCodeBlocks.length > 0);

				// Extract thinking
				let thinking: string | null = null;
				if (bubble.allThinkingBlocks && bubble.allThinkingBlocks.length > 0) {
					const thinkingTexts = bubble.allThinkingBlocks
						.map((b) => b.thinking || b.text || "")
						.filter(Boolean);
					if (thinkingTexts.length > 0) {
						thinking = thinkingTexts.join("\n");
					}
				} else if (bubble.thinking) {
					thinking = bubble.thinking;
				}

				const timestamp = bubble.createdAt || new Date().toISOString();
				const bubbleId =
					bubble.bubbleId || (row[0] as string).split(":").pop() || "";

				messages.push({
					id: bubbleId,
					parentUuid: null,
					type: msgType,
					role: msgType,
					content: text,
					hasToolUse: !!hasToolUse,
					hasCode: !!hasCode,
					thinking,
					timestamp,
				});
			}
		} finally {
			db.close();
		}

		// Sort by timestamp
		messages.sort(
			(a, b) =>
				new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
		);

		const projectName = extractProjectName(meta.projectDir);

		return {
			id: meta.id,
			slug,
			source: "cursor",
			projectDir: meta.projectDir,
			projectName,
			cwd: meta.projectDir || null,
			gitBranch: null,
			messages,
			firstMessageAt: messages[0]?.timestamp ?? new Date().toISOString(),
			lastMessageAt:
				messages[messages.length - 1]?.timestamp ?? new Date().toISOString(),
		};
	},
};

function emptyConversation(meta: ConversationMeta): ParsedConversation {
	return {
		id: meta.id,
		slug: null,
		source: "cursor",
		projectDir: meta.projectDir,
		projectName: extractProjectName(meta.projectDir),
		cwd: meta.projectDir || null,
		gitBranch: null,
		messages: [],
		firstMessageAt: new Date().toISOString(),
		lastMessageAt: new Date().toISOString(),
	};
}
