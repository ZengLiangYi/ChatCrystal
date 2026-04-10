import { createReadStream, existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
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
// Platform-specific paths
// =============================================

function getCopilotBasePath(): string {
	if (appConfig.copilotDataDir) return appConfig.copilotDataDir;

	const p = platform();
	if (p === "win32") {
		return resolve(process.env.APPDATA || "", "Code", "User");
	} else if (p === "darwin") {
		return resolve(homedir(), "Library", "Application Support", "Code", "User");
	} else {
		return resolve(homedir(), ".config", "Code", "User");
	}
}

function getWorkspaceStoragePath(): string {
	return resolve(getCopilotBasePath(), "workspaceStorage");
}

function getGlobalChatSessionsPath(): string {
	return resolve(
		getCopilotBasePath(),
		"globalStorage",
		"emptyWindowChatSessions",
	);
}

// =============================================
// JSONL session types
// =============================================

interface CopilotSessionData {
	version: number;
	sessionId: string;
	creationDate: number; // epoch ms
	customTitle?: string | null;
	requests: CopilotRequest[];
}

interface CopilotSessionSnapshot {
	kind?: number; // 0 for JSONL snapshots, absent for .json
	v?: CopilotSessionData; // JSONL format wraps in v
	// .json format has fields at top level
	requests?: CopilotRequest[];
	sessionId?: string;
	creationDate?: number;
	customTitle?: string | null;
	version?: number;
}

interface CopilotRequest {
	requestId: string;
	timestamp: number; // epoch ms
	modelId?: string;
	message?: {
		text: string;
		parts?: Array<{ text?: string; kind?: string }>;
	};
	response?: CopilotResponseItem[];
	result?: {
		metadata?: {
			toolCallRounds?: number;
		};
	};
}

interface CopilotResponseItem {
	kind?: string; // 'text' | 'thinking' | 'toolInvocationSerialized' | 'mcpServersStarting' | 'prepareToolInvocation' | 'inlineReference' | undefined
	value?: string;
	id?: string;
	invocationMessage?: string;
}

// =============================================
// Workspace scanning
// =============================================

interface SessionFileInfo {
	filePath: string;
	sessionId: string;
	projectDir: string;
	fileSize: number;
	fileMtime: string;
}

// Brief cache to avoid double scan during detect() → scan() cycle
let scanCache: { result: SessionFileInfo[]; expiry: number } | null = null;

async function scanChatSessions(): Promise<SessionFileInfo[]> {
	if (scanCache && Date.now() < scanCache.expiry) {
		return scanCache.result;
	}
	const result = await scanChatSessionsImpl();
	scanCache = { result, expiry: Date.now() + 5000 }; // 5s TTL
	return result;
}

async function scanChatSessionsImpl(): Promise<SessionFileInfo[]> {
	const results: SessionFileInfo[] = [];

	// 1. Workspace-specific sessions
	const wsPath = getWorkspaceStoragePath();
	if (existsSync(wsPath)) {
		const entries = await readdir(wsPath);
		for (const hash of entries) {
			const chatDir = resolve(wsPath, hash, "chatSessions");
			if (!existsSync(chatDir)) continue;

			// Read workspace folder
			let folder = "";
			const wsJsonPath = resolve(wsPath, hash, "workspace.json");
			if (existsSync(wsJsonPath)) {
				try {
					const wsJson = JSON.parse(await readFile(wsJsonPath, "utf-8"));
					const rawFolder = (wsJson.folder as string) || "";
					folder = decodeURIComponent(rawFolder.replace(/^file:\/\/\//, ""));
				} catch {
					// skip
				}
			}

			const files = await readdir(chatDir);
			for (const file of files) {
				const ext = file.endsWith(".jsonl")
					? ".jsonl"
					: file.endsWith(".json")
						? ".json"
						: null;
				if (!ext) continue;
				const fp = resolve(chatDir, file);
				try {
					const s = await stat(fp);
					if (s.size < 100) continue;
					results.push({
						filePath: fp,
						sessionId: basename(file, ext),
						projectDir: folder,
						fileSize: s.size,
						fileMtime: s.mtime.toISOString(),
					});
				} catch {
					// skip
				}
			}
		}
	}

	// 2. Global (empty window) sessions
	const globalDir = getGlobalChatSessionsPath();
	if (existsSync(globalDir)) {
		const files = await readdir(globalDir);
		for (const file of files) {
			const ext = file.endsWith(".jsonl")
				? ".jsonl"
				: file.endsWith(".json")
					? ".json"
					: null;
			if (!ext) continue;
			const fp = resolve(globalDir, file);
			try {
				const s = await stat(fp);
				if (s.size < 100) continue;
				results.push({
					filePath: fp,
					sessionId: basename(file, ext),
					projectDir: "",
					fileSize: s.size,
					fileMtime: s.mtime.toISOString(),
				});
			} catch {
				// skip
			}
		}
	}

	return results;
}

// =============================================
// Content extraction
// =============================================

function extractResponseContent(response: CopilotResponseItem[]): {
	text: string;
	thinking: string | null;
	hasToolUse: boolean;
	hasCode: boolean;
} {
	const texts: string[] = [];
	const thinkingParts: string[] = [];
	let hasToolUse = false;
	let hasCode = false;

	for (const item of response) {
		switch (item.kind) {
			case "thinking":
				if (item.value) thinkingParts.push(item.value);
				break;
			case "text":
				if (item.value) {
					texts.push(item.value);
					if (item.value.includes("```")) hasCode = true;
				}
				break;
			case "toolInvocationSerialized":
			case "prepareToolInvocation":
				hasToolUse = true;
				break;
			case "mcpServersStarting":
			case "inlineReference":
				// Skip these
				break;
			case undefined:
				// Text response without explicit kind
				if (item.value) {
					texts.push(item.value);
					if (item.value.includes("```")) hasCode = true;
				}
				break;
		}
	}

	const fullText = texts.join("\n").trim();

	return {
		text: fullText,
		thinking: thinkingParts.length > 0 ? thinkingParts.join("\n") : null,
		hasToolUse,
		hasCode,
	};
}

// =============================================
// Project name extraction
// =============================================

function extractProjectName(folder: string): string {
	if (!folder) return "Global";
	const normalized = folder.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] || folder;
}

// =============================================
// Exported helper for watcher
// =============================================

export function getCopilotWatchPaths(): string[] {
	const paths: string[] = [];

	const wsPath = getWorkspaceStoragePath();
	if (existsSync(wsPath)) {
		paths.push(`${wsPath}/*/chatSessions/*.jsonl`);
		paths.push(`${wsPath}/*/chatSessions/*.json`);
	}

	const globalDir = getGlobalChatSessionsPath();
	if (existsSync(globalDir)) {
		paths.push(`${globalDir}/*.jsonl`);
		paths.push(`${globalDir}/*.json`);
	}

	return paths;
}

// =============================================
// Copilot Adapter
// =============================================

export const copilotAdapter: SourceAdapter = {
	name: "copilot",
	displayName: "GitHub Copilot",

	async detect(): Promise<SourceInfo | null> {
		try {
			const sessions = await scanChatSessions();
			if (sessions.length === 0) return null;

			return {
				name: "copilot",
				displayName: "GitHub Copilot",
				dataDir: getCopilotBasePath(),
				conversationCount: sessions.length,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		const sessions = await scanChatSessions();
		return sessions.map((s) => ({
			id: s.sessionId,
			source: "copilot",
			filePath: s.filePath,
			fileSize: s.fileSize,
			fileMtime: s.fileMtime,
			projectDir: s.projectDir,
		}));
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		try {
			// .json files: single JSON object (older format)
			// .jsonl files: first line is snapshot (kind:0), rest are UI state patches (kind:1)
			const isJson = meta.filePath.endsWith(".json");
			let snapshotText: string | null;

			if (isJson) {
				snapshotText = await readFile(meta.filePath, "utf-8");
			} else {
				snapshotText = await readFirstLine(meta.filePath);
			}

			if (!snapshotText) return emptyConversation(meta);

			let snapshot: CopilotSessionSnapshot;
			try {
				snapshot = JSON.parse(snapshotText);
			} catch {
				return emptyConversation(meta);
			}

			// Normalize: .jsonl wraps in {kind:0, v:{...}}, .json has data at top level
			if (snapshot.kind !== undefined && snapshot.kind !== 0) {
				return emptyConversation(meta);
			}

			const sessionData: CopilotSessionData = snapshot.v ?? {
				version: snapshot.version ?? 0,
				sessionId: snapshot.sessionId ?? meta.id,
				creationDate: snapshot.creationDate ?? 0,
				customTitle: snapshot.customTitle,
				requests: snapshot.requests ?? [],
			};

			if (!sessionData.requests?.length) {
				return emptyConversation(meta);
			}
			const messages: ParsedMessage[] = [];

			for (const req of sessionData.requests) {
				// User message
				const userText = req.message?.text?.trim();
				if (userText) {
					messages.push({
						id: req.requestId || `user-${req.timestamp}`,
						parentUuid: null,
						type: "user",
						role: "user",
						content: userText,
						hasToolUse: false,
						hasCode: userText.includes("```"),
						thinking: null,
						timestamp: new Date(req.timestamp).toISOString(),
					});
				}

				// Assistant response
				if (req.response && req.response.length > 0) {
					const { text, thinking, hasToolUse, hasCode } =
						extractResponseContent(req.response);

					if (text || thinking) {
						messages.push({
							id: req.requestId
								? `resp-${req.requestId}`
								: `resp-${req.timestamp}`,
							parentUuid: null,
							type: "assistant",
							role: "assistant",
							content: text,
							hasToolUse,
							hasCode,
							thinking,
							timestamp: new Date(req.timestamp + 1).toISOString(), // +1ms to order after user
						});
					}
				}
			}

			// Sort by timestamp
			messages.sort(
				(a, b) =>
					new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
			);

			const projectName = extractProjectName(meta.projectDir);
			const slug = sessionData.customTitle || null;

			return {
				id: sessionData.sessionId || meta.id,
				slug,
				source: "copilot",
				projectDir: meta.projectDir,
				projectName,
				cwd: meta.projectDir || null,
				gitBranch: null,
				messages,
				firstMessageAt: messages[0]?.timestamp ?? new Date().toISOString(),
				lastMessageAt:
					messages[messages.length - 1]?.timestamp ?? new Date().toISOString(),
			};
		} catch {
			return emptyConversation(meta);
		}
	},
};

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

function emptyConversation(meta: ConversationMeta): ParsedConversation {
	return {
		id: meta.id,
		slug: null,
		source: "copilot",
		projectDir: meta.projectDir,
		projectName: extractProjectName(meta.projectDir),
		cwd: meta.projectDir || null,
		gitBranch: null,
		messages: [],
		firstMessageAt: new Date().toISOString(),
		lastMessageAt: new Date().toISOString(),
	};
}
