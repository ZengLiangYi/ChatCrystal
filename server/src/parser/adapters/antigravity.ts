import { existsSync, type Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
	ConversationMeta,
	ParsedConversation,
	ParsedMessage,
	SourceInfo,
} from "@chatcrystal/shared";
import { appConfig } from "../../config.js";
import type { SourceAdapter } from "../adapter.js";
import { wslRootsFor } from "../sourceRoots.js";
import { openVscdb } from "../vscdb.js";

// =============================================
// Google Antigravity session format
// =============================================
//
// <antigravityDataDir>/brain/<conversation-id>/.system_generated/logs/transcript.jsonl
//
// One step per line: {step_index, source, type, status, created_at(ISO),
// content, thinking, tool_calls}. Only USER_INPUT (the person's prompt) and
// PLANNER_RESPONSE (the assistant turn) carry conversation; GENERIC (tool
// output / system info), EPHEMERAL_MESSAGE, CHECKPOINT, SYSTEM_MESSAGE and
// ERROR_MESSAGE are noise. A transcript_full.jsonl is used when the trimmed
// transcript.jsonl is missing.
//
// The transcript carries no workspace, so the project is read from the IDE's
// conversation_summaries.db (workspace_uris, a JSON array of file:// URIs);
// when that DB is missing or unreadable the conversation degrades to no
// project instead of failing.
//
// The same layout also lives inside a WSL distro under `~/.gemini/antigravity`;
// the CLI build of Antigravity keeps it under `~/.gemini/antigravity-cli`
// instead (observed in a real WSL distro, and the same folder name is used by
// the Windows CLI build), so both relative paths are scanned. Every WSL root is
// returned by `wslRootsFor` and `meta.rootDir` selects the summary DB of a WSL
// session in `parse()`.

const WSL_RELATIVE_DIRS = [".gemini/antigravity", ".gemini/antigravity-cli"];

interface AntigravityToolCall {
	name?: string;
	args?: unknown;
}

interface AntigravityStep {
	step_index?: number;
	source?: string;
	type?: string;
	status?: string;
	created_at?: string;
	content?: unknown;
	thinking?: unknown;
	tool_calls?: AntigravityToolCall[];
}

const TRANSCRIPT_FILE_NAMES = ["transcript.jsonl", "transcript_full.jsonl"];

/** Pick the transcript file of one brain/<conversation-id> folder. */
async function pickTranscriptFile(
	conversationDir: string,
): Promise<{ filePath: string; fileSize: number; fileMtime: string } | null> {
	const logsDir = join(conversationDir, ".system_generated", "logs");
	for (const fileName of TRANSCRIPT_FILE_NAMES) {
		const filePath = join(logsDir, fileName);
		try {
			const fileStat = await stat(filePath);
			if (!fileStat.isFile()) continue;
			return {
				filePath,
				fileSize: fileStat.size,
				fileMtime: fileStat.mtime.toISOString(),
			};
		} catch {
			// Not this candidate.
		}
	}
	return null;
}

async function collectSessionFiles(
	root: string,
): Promise<
	{ id: string; filePath: string; fileSize: number; fileMtime: string }[]
> {
	const brainDir = resolve(root, "brain");
	if (!existsSync(brainDir)) return [];

	let entries: Dirent[];
	try {
		entries = await readdir(brainDir, { withFileTypes: true });
	} catch {
		return [];
	}

	const sessions: {
		id: string;
		filePath: string;
		fileSize: number;
		fileMtime: string;
	}[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		const picked = await pickTranscriptFile(resolve(brainDir, entry.name));
		if (!picked) continue;
		sessions.push({ id: entry.name, ...picked });
	}

	return sessions;
}

/**
 * Antigravity data roots: the local IDE data dir, the local Antigravity CLI
 * sibling (`~/.gemini/antigravity-cli`, same layout), and every WSL distro home
 * that has one of the known layouts. The primary root stays first; duplicate
 * paths (several relative layouts in the same home) are dropped.
 */
function dataRoots(): string[] {
	const primary = appConfig.antigravityDataDir;
	const roots: string[] = [primary];
	const localCliDir = resolve(dirname(primary), "antigravity-cli");
	if (existsSync(localCliDir)) roots.push(localCliDir);

	for (const relative of WSL_RELATIVE_DIRS) {
		for (const root of wslRootsFor(relative)) {
			if (!roots.includes(root)) roots.push(root);
		}
	}
	return roots;
}

// =============================================
// Conversation metadata (workspace + title)
// =============================================

interface ConversationSummary {
	title: string | null;
	workspaceUris: string[];
}

/** One cached summary DB, keyed by the DB path so roots never share entries. */
interface SummaryCacheEntry {
	mtimeMs: number;
	summaries: Map<string, ConversationSummary>;
}

const summaryCache = new Map<string, SummaryCacheEntry>();

function parseWorkspaceUris(value: unknown): string[] {
	let parsed = value;
	if (typeof parsed === "string") {
		try {
			parsed = JSON.parse(parsed) as unknown;
		} catch {
			return [];
		}
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter(
		(uri): uri is string => typeof uri === "string" && uri.trim().length > 0,
	);
}

/** Load conversation_id → title/workspace map from one root's summary DB. */
async function loadConversationSummaries(
	root: string,
): Promise<Map<string, ConversationSummary>> {
	const dbPath = resolve(root, "conversation_summaries.db");
	if (!existsSync(dbPath)) return new Map();

	let mtimeMs = 0;
	try {
		mtimeMs = (await stat(dbPath)).mtimeMs;
	} catch {
		return new Map();
	}
	const cached = summaryCache.get(dbPath);
	if (cached && cached.mtimeMs === mtimeMs) {
		return cached.summaries;
	}

	const summaries = new Map<string, ConversationSummary>();
	const db = await openVscdb(dbPath);
	if (db) {
		try {
			const statement = db.prepare(
				"SELECT conversation_id, title, workspace_uris FROM conversation_summaries",
			);
			while (statement.step()) {
				const row = statement.getAsObject() as Record<string, unknown>;
				const conversationId =
					typeof row.conversation_id === "string" ? row.conversation_id : "";
				if (!conversationId) continue;
				const rawTitle = row.title;
				const title =
					typeof rawTitle === "string" && rawTitle.trim()
						? rawTitle.trim()
						: null;
				summaries.set(conversationId, {
					title,
					workspaceUris: parseWorkspaceUris(row.workspace_uris),
				});
			}
			statement.free();
		} catch {
			// Unknown schema / locked DB: silently degrade to no metadata.
		} finally {
			db.close();
		}
	}

	summaryCache.set(dbPath, { mtimeMs, summaries });
	return summaries;
}

/** Decode a file:// workspace URI into a native-looking path. */
function workspaceUriToPath(uri: string): string | null {
	const trimmed = uri.trim();
	if (!trimmed) return null;

	let decoded = trimmed;
	try {
		decoded = decodeURIComponent(trimmed);
	} catch {
		decoded = trimmed;
	}

	const windowsDrive = /^file:\/\/\/([a-zA-Z]):\/(.*)$/s.exec(decoded);
	if (windowsDrive) {
		return `${windowsDrive[1].toUpperCase()}:/${windowsDrive[2]}`;
	}
	if (decoded.startsWith("file:///")) {
		return `/${decoded.slice("file:///".length)}`;
	}
	if (decoded.startsWith("file://")) {
		return decoded.slice("file://".length);
	}
	return decoded;
}

// =============================================
// Content helpers
// =============================================

/**
 * Extract the person's request from a USER_INPUT step. The IDE wraps the prompt
 * in <USER_REQUEST> and appends machine metadata (<ADDITIONAL_METADATA>,
 * <USER_SETTINGS_CHANGE>, uploaded-media notes) to the same string.
 */
function extractUserRequest(content: string): string {
	let text = content;
	text = text.replace(
		/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g,
		"",
	);
	text = text.replace(
		/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g,
		"",
	);
	// Plan approvals/rejections append a comment line that is not the request.
	text = text.replace(/^Comments on artifact URI:.*$/gm, "");

	const requestMatch = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/.exec(text);
	if (requestMatch) return (requestMatch[1] ?? "").trim();

	// No wrapper: strip whatever XML-ish tags are left. Repeat until stable so
	// nested fragments cannot reassemble a tag after a single pass.
	let sanitized = text;
	for (let pass = 0; pass < 5; pass += 1) {
		const next = sanitized.replace(/<[^>]*>/g, "");
		if (next === sanitized) break;
		sanitized = next;
	}
	return sanitized.trim();
}

/** Last path segment, accepting both Windows and POSIX separators. */
function extractProjectName(path: string): string {
	const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? "";
}

function stepTimestamp(step: AntigravityStep, fallbackIso: string): string {
	if (typeof step.created_at === "string" && step.created_at.trim()) {
		const date = new Date(step.created_at);
		if (!Number.isNaN(date.getTime())) return date.toISOString();
	}
	return fallbackIso;
}

// =============================================
// Antigravity Adapter
// =============================================

export const antigravityAdapter: SourceAdapter = {
	name: "antigravity",
	displayName: "Antigravity",
	parserVersion: "antigravity@2",

	async detect(): Promise<SourceInfo | null> {
		try {
			let conversationCount = 0;
			for (const root of dataRoots()) {
				try {
					conversationCount += (await collectSessionFiles(root)).length;
				} catch {
					// A WSL distro can stop mid-scan; keep the other roots.
				}
			}
			if (conversationCount === 0) return null;

			return {
				name: "antigravity",
				displayName: "Antigravity",
				dataDir: appConfig.antigravityDataDir,
				conversationCount,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		const metas: ConversationMeta[] = [];
		for (const root of dataRoots()) {
			try {
				const sessions = await collectSessionFiles(root);
				for (const session of sessions) {
					metas.push({
						id: session.id,
						source: "antigravity",
						filePath: session.filePath,
						fileSize: session.fileSize,
						fileMtime: session.fileMtime,
						// projectDir is resolved from conversation_summaries.db in parse().
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
		const fileMtimeIso = meta.fileMtime || new Date().toISOString();

		let fileText = "";
		try {
			fileText = await readFile(meta.filePath, "utf8");
		} catch {
			fileText = "";
		}

		// The title/workspace DB lives at the root the transcript came from; a
		// WSL-backed conversation must not read the Windows install's DB.
		const root = meta.rootDir ?? appConfig.antigravityDataDir;
		let summaries = new Map<string, ConversationSummary>();
		try {
			summaries = await loadConversationSummaries(root);
		} catch {
			summaries = new Map();
		}
		const summary = summaries.get(meta.id);
		const firstWorkspaceUri = summary?.workspaceUris[0];
		const cwd = firstWorkspaceUri ? workspaceUriToPath(firstWorkspaceUri) : null;

		let lineIndex = 0;
		for (const line of fileText.split("\n")) {
			if (!line.trim()) continue;

			let step: AntigravityStep;
			try {
				step = JSON.parse(line) as AntigravityStep;
			} catch {
				continue; // Truncated / malformed line
			}
			if (!step || typeof step !== "object") continue;

			const stepIndex =
				typeof step.step_index === "number" && Number.isFinite(step.step_index)
					? step.step_index
					: lineIndex;
			lineIndex++;
			const timestamp = stepTimestamp(step, fileMtimeIso);
			const messageId = `${meta.id}-step-${stepIndex}`;

			if (step.type === "USER_INPUT") {
				const content =
					typeof step.content === "string"
						? extractUserRequest(step.content)
						: "";
				if (!content) continue;

				messages.push({
					id: messageId,
					parentUuid: null,
					type: "user",
					role: "user",
					content,
					hasToolUse: false,
					hasCode: content.includes("```"),
					thinking: null,
					timestamp,
				});
				continue;
			}

			if (step.type === "PLANNER_RESPONSE") {
				const content =
					typeof step.content === "string" ? step.content.trim() : "";
				const thinking =
					typeof step.thinking === "string" ? step.thinking.trim() : "";
				const hasToolUse =
					Array.isArray(step.tool_calls) && step.tool_calls.length > 0;
				// A planner step that only thought (no text yet) is still the
				// assistant's turn.
				if (!content && !thinking && !hasToolUse) continue;

				messages.push({
					id: messageId,
					parentUuid: null,
					type: "assistant",
					role: "assistant",
					content,
					hasToolUse,
					hasCode: content.includes("```"),
					thinking: thinking || null,
					timestamp,
				});
				continue;
			}

			// GENERIC (tool output / system info), EPHEMERAL_MESSAGE, CHECKPOINT,
			// SYSTEM_MESSAGE, ERROR_MESSAGE, ... are not conversation.
		}

		const projectDir = cwd || meta.projectDir || "";
		return {
			id: meta.id,
			slug: summary?.title ?? null,
			source: "antigravity",
			projectDir,
			projectName: extractProjectName(projectDir),
			cwd,
			gitBranch: null,
			messages,
			firstMessageAt: messages[0]?.timestamp ?? fileMtimeIso,
			lastMessageAt:
				messages[messages.length - 1]?.timestamp ?? fileMtimeIso,
		};
	},

	watchPaths(): string[] {
		// Watch the local install only: watching `\\wsl.localhost` UNC paths is
		// slow and would start stopped distros. WSL sessions are picked up on the
		// next manual Import.
		return [resolve(appConfig.antigravityDataDir, "brain/**/*.jsonl")];
	},
};
