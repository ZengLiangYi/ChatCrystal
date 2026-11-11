/**
 * Grok Build adapter.
 *
 * Grok Build keeps every session in a folder of its own, grouped by working
 * directory (URL-encoded) under `<grokDataDir>/sessions`:
 *
 *   <grokDataDir>/sessions/<url-encoded-cwd>/<session-id>/
 *     summary.json   — info.id, info.cwd, generated_title / session_summary,
 *                      created_at, parent_session_id, session_kind
 *     updates.jsonl  — the session's events, one ACP `session/update` a line,
 *                      each with a `timestamp` in seconds
 *
 * `updates.jsonl` is the conversation: `user_message_chunk`s are the user's
 * prompts, `agent_message_chunk`s the model's text, `agent_thought_chunk`s its
 * thinking and `tool_call`s its tool uses. Progress (`tool_call_update`) and
 * bookkeeping (`turn_completed`, `hook_execution`, `compaction_checkpoint`,
 * ...) are not conversation. A user chunk whose `_meta.hostTurn` is set is a
 * host command (`/compact`), not something the person typed.
 *
 * A fork copies its source's updates before its own; the summary's
 * `parent_session_id` and `created_at` tell copied lines (older) from the
 * fork's own, so a fork reads as the turns it added.
 *
 * A WSL distro home is scanned too: `<distro-home>/.grok`.
 */

import { existsSync, type Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
	ConversationMeta,
	ParsedConversation,
	ParsedMessage,
	SourceInfo,
} from "@chatcrystal/shared";
import { appConfig } from "../../config.js";
import type { SourceAdapter } from "../adapter.js";
import { withWslRoots } from "../sourceRoots.js";

const SOURCE = "grok";
const DISPLAY_NAME = "Grok Build";
const SESSIONS_DIR = "sessions";
/** Distro-home-relative location of Grok Build's data folder. */
const WSL_RELATIVE = ".grok";

// =============================================
// Raw file shapes
// =============================================

interface GrokSummary {
	info?: {
		id?: unknown;
		cwd?: unknown;
	};
	generated_title?: unknown;
	session_summary?: unknown;
	created_at?: unknown;
	parent_session_id?: unknown;
	session_kind?: unknown;
}

interface GrokContent {
	type?: unknown;
	text?: unknown;
}

interface GrokUpdate {
	sessionUpdate?: unknown;
	content?: GrokContent;
	_meta?: {
		hostTurn?: unknown;
	};
}

interface GrokLine {
	timestamp?: unknown;
	params?: {
		update?: GrokUpdate;
	};
}

// =============================================
// Paths
// =============================================

function getDataDir(): string {
	return appConfig.grokDataDir;
}

/** The Windows-local install plus every WSL distro home that has a `.grok`. */
function grokRoots(): string[] {
	return withWslRoots(getDataDir(), WSL_RELATIVE);
}

function sessionsDirFor(root: string): string {
	return resolve(root, SESSIONS_DIR);
}

// =============================================
// Summary / timestamp helpers
// =============================================

async function readSummary(sessionDir: string): Promise<GrokSummary | null> {
	try {
		const raw = JSON.parse(
			await readFile(resolve(sessionDir, "summary.json"), "utf-8"),
		) as unknown;
		if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
			return null;
		}
		return raw as GrokSummary;
	} catch {
		// Missing or half-written summary: fall back to the folder name.
		return null;
	}
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function summarySessionId(summary: GrokSummary | null, fallback: string): string {
	return stringField(summary?.info?.id) || fallback;
}

function summaryCwd(summary: GrokSummary | null): string {
	return stringField(summary?.info?.cwd);
}

/** The model-generated title (`generated_title`, else `session_summary`). */
function summaryTitle(summary: GrokSummary | null): string {
	return (
		stringField(summary?.generated_title) || stringField(summary?.session_summary)
	);
}

/** Epoch milliseconds of the session's `created_at`, when it parses. */
function summaryCreatedMs(summary: GrokSummary | null): number | null {
	const raw = summary?.created_at;
	if (typeof raw === "number" && Number.isFinite(raw)) return raw;
	if (typeof raw === "string") {
		const parsed = Date.parse(raw);
		return Number.isNaN(parsed) ? null : parsed;
	}
	return null;
}

/**
 * An ACP update's time: epoch seconds by default, epoch milliseconds when the
 * number is large enough to be that. ISO strings are accepted too.
 */
function lineTimeMs(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return value > 1e11 ? value : value * 1000;
	}
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		return Number.isNaN(parsed) ? null : parsed;
	}
	return null;
}

function extractProjectName(projectDir: string): string {
	const normalized = projectDir.replace(/\\/g, "/").replace(/\/+$/, "");
	const segments = normalized.split("/").filter(Boolean);
	return segments[segments.length - 1] ?? "";
}

function truncateSlug(text: string, maxLength = 80): string | null {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return null;
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, Math.max(1, maxLength - 3))}...`;
}

// =============================================
// Scanning
// =============================================

async function scanSessions(): Promise<ConversationMeta[]> {
	const metas: ConversationMeta[] = [];

	for (const root of grokRoots()) {
		const sessionsDir = sessionsDirFor(root);

		let cwdDirs: Dirent[];
		try {
			cwdDirs = await readdir(sessionsDir, { withFileTypes: true });
		} catch {
			// A root may disappear while a WSL distro stops; keep the others.
			continue;
		}

		for (const cwdDir of cwdDirs) {
			if (!cwdDir.isDirectory()) continue;
			const cwdDirPath = resolve(sessionsDir, cwdDir.name);

			let sessionDirs: Dirent[];
			try {
				sessionDirs = await readdir(cwdDirPath, { withFileTypes: true });
			} catch {
				continue;
			}

			for (const sessionDirEntry of sessionDirs) {
				if (!sessionDirEntry.isDirectory()) continue;
				const sessionDir = resolve(cwdDirPath, sessionDirEntry.name);
				const filePath = resolve(sessionDir, "updates.jsonl");

				const fileStat = await stat(filePath).catch(() => null);
				if (!fileStat?.isFile()) continue;

				const summary = await readSummary(sessionDir);
				// Fold the summary into the meta: a retitled session still imports.
				const times = { size: fileStat.size, mtime: fileStat.mtime };
				const summaryStat = await stat(resolve(sessionDir, "summary.json")).catch(
					() => null,
				);
				if (summaryStat?.isFile()) {
					times.size += summaryStat.size;
					if (summaryStat.mtime > times.mtime) times.mtime = summaryStat.mtime;
				}

				metas.push({
					id: summarySessionId(summary, sessionDirEntry.name),
					source: SOURCE,
					filePath,
					fileSize: times.size,
					fileMtime: times.mtime.toISOString(),
					projectDir: summaryCwd(summary),
					rootDir: root,
				});
			}
		}
	}

	return metas;
}

// =============================================
// Parsing
// =============================================

interface AssistantBuffer {
	texts: string[];
	thinking: string[];
	hasToolUse: boolean;
	startMs: number | null;
}

function emptyAssistantBuffer(): AssistantBuffer {
	return { texts: [], thinking: [], hasToolUse: false, startMs: null };
}

function contentText(content: GrokContent | undefined): string {
	if (!content || content.type !== "text") return "";
	return typeof content.text === "string" ? content.text : "";
}

async function parseSession(meta: ConversationMeta): Promise<ParsedConversation> {
	const conversationId = meta.id;
	const sessionDir = dirname(meta.filePath);
	const summary = await readSummary(sessionDir);
	const projectDir = summaryCwd(summary) || meta.projectDir || "";

	// A fork starts with a copy of its source's updates; only the lines written
	// from the fork's creation time on are its own turns.
	const createdMs = summaryCreatedMs(summary);
	const forkedFrom = stringField(summary?.parent_session_id);
	const forkSinceMs =
		forkedFrom && createdMs !== null
			? Math.floor(createdMs / 1000) * 1000
			: null;

	let fileText = "";
	try {
		fileText = await readFile(meta.filePath, "utf8");
	} catch {
		fileText = "";
	}

	const fallbackMs = (() => {
		const parsed = Date.parse(meta.fileMtime);
		return Number.isNaN(parsed) ? Date.now() : parsed;
	})();

	const messages: ParsedMessage[] = [];
	let lastKnownMs = fallbackMs - 1000;
	let lastEmittedMs = Number.NEGATIVE_INFINITY;

	/** Turn a buffered message's first-line time into an ascending ISO stamp. */
	const messageTimestamp = (startMs: number | null): string => {
		const candidate =
			startMs !== null ? startMs : lastKnownMs + 1000;
		const timestamp = Math.max(candidate, lastEmittedMs + 1);
		lastEmittedMs = timestamp;
		lastKnownMs = Math.max(lastKnownMs, timestamp);
		return new Date(timestamp).toISOString();
	};

	let userText = "";
	let userStartMs: number | null = null;
	let assistant = emptyAssistantBuffer();

	const flushUser = (): void => {
		const content = userText.trim();
		const startMs = userStartMs;
		userText = "";
		userStartMs = null;
		if (!content) return;
		messages.push({
			id: `${conversationId}-${messages.length}`,
			parentUuid: null,
			type: "user",
			role: "user",
			content,
			hasToolUse: false,
			hasCode: content.includes("```"),
			thinking: null,
			timestamp: messageTimestamp(startMs),
		});
	};

	const flushAssistant = (): void => {
		const content = assistant.texts.join("").trim();
		const thinking = assistant.thinking.join("\n").trim();
		const hasToolUse = assistant.hasToolUse;
		const startMs = assistant.startMs;
		assistant = emptyAssistantBuffer();
		if (!content && !thinking && !hasToolUse) return;
		const timestamp = messageTimestamp(startMs);
		messages.push({
			id: `${conversationId}-${messages.length}`,
			parentUuid: null,
			type: "assistant",
			role: "assistant",
			content,
			hasToolUse,
			hasCode: content.includes("```"),
			thinking: thinking || null,
			timestamp,
		});
	};

	for (const line of fileText.split("\n")) {
		if (!line.trim()) continue;

		let parsed: GrokLine;
		try {
			parsed = JSON.parse(line) as GrokLine;
		} catch {
			continue; // Skip malformed lines, keep the rest of the session.
		}
		if (!parsed || typeof parsed !== "object") continue;

		const lineMs = lineTimeMs(parsed.timestamp);
		if (forkSinceMs !== null && lineMs !== null && lineMs < forkSinceMs) {
			continue; // Copied from the fork's source.
		}
		if (lineMs !== null) lastKnownMs = Math.max(lastKnownMs, lineMs);

		const update = parsed.params?.update;
		if (!update || typeof update !== "object") continue;

		switch (stringField(update.sessionUpdate)) {
			case "user_message_chunk": {
				// A host command (`/compact`, ...) is marked hostTurn.
				if (update._meta?.hostTurn === true) break;
				const text = contentText(update.content);
				if (!text) break;
				flushAssistant();
				if (userStartMs === null) userStartMs = lineMs;
				userText += text;
				break;
			}
			case "agent_message_chunk": {
				const text = contentText(update.content);
				if (!text) break;
				flushUser();
				if (assistant.startMs === null) assistant.startMs = lineMs;
				assistant.texts.push(text);
				break;
			}
			case "agent_thought_chunk": {
				const text = contentText(update.content);
				if (!text) break;
				flushUser();
				if (assistant.startMs === null) assistant.startMs = lineMs;
				assistant.thinking.push(text);
				break;
			}
			case "tool_call": {
				flushUser();
				if (assistant.startMs === null) assistant.startMs = lineMs;
				assistant.hasToolUse = true;
				break;
			}
			case "turn_completed": {
				flushUser();
				flushAssistant();
				break;
			}
			default:
				// tool_call_update, hook_execution, compaction, ... are not turns.
				break;
		}
	}
	flushUser();
	flushAssistant();

	messages.sort(
		(a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
	);

	const firstUserText =
		messages.find((message) => message.type === "user")?.content ?? "";
	const fallbackIso = new Date(fallbackMs).toISOString();
	const createdIso =
		createdMs !== null ? new Date(createdMs).toISOString() : fallbackIso;

	return {
		id: conversationId,
		slug: truncateSlug(summaryTitle(summary) || firstUserText),
		source: SOURCE,
		projectDir,
		projectName: projectDir ? extractProjectName(projectDir) : "",
		cwd: projectDir || null,
		gitBranch: null,
		messages,
		firstMessageAt: messages[0]?.timestamp ?? createdIso,
		lastMessageAt: messages[messages.length - 1]?.timestamp ?? createdIso,
	};
}

// =============================================
// Grok Build Adapter
// =============================================

export const grokAdapter: SourceAdapter = {
	name: SOURCE,
	displayName: DISPLAY_NAME,
	parserVersion: "grok@1",

	async detect(): Promise<SourceInfo | null> {
		try {
			const metas = await scanSessions();
			if (metas.length === 0) return null;
			return {
				name: SOURCE,
				displayName: DISPLAY_NAME,
				// The primary install stays the reported data dir even when the only
				// sessions found are inside a WSL distro.
				dataDir: getDataDir(),
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
		return parseSession(meta);
	},

	watchPaths(): string[] {
		const sessionsDir = sessionsDirFor(getDataDir());
		if (!existsSync(sessionsDir)) return [];
		// Only the Windows-local store is watched: `\\wsl.localhost` paths are
		// slow and may start a stopped distro. WSL conversations sync on the next
		// manual Import.
		return [resolve(sessionsDir, "**", "updates.jsonl")];
	},
};
