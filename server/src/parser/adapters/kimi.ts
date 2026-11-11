/**
 * Kimi Code adapter.
 *
 * Kimi Code keeps a session in its own folder under its sessions folder,
 * grouped by a slug of the working directory:
 *
 *   <kimiDataDir>/sessions/<workdir-slug>/<session-id>/
 *     state.json              — title / titleKind / isCustomTitle / customTitle,
 *                               cwd (or workDir before protocol 1.5),
 *                               createdAt / updatedAt (epoch ms, or RFC 3339
 *                               strings on older sessions)
 *     agents/main/wire.jsonl  — the session's records, one per line
 *
 * The main agent is `agents/main`; a subagent's `agents/<other>/wire.jsonl`
 * are its own files and are skipped here.
 *
 * The records read as conversation:
 * - `turn.prompt` / `turn.steer` whose `origin.kind` is "user" — the person's
 *   words, in `input[].text`;
 * - `context.append_loop_event` with `event.type` "content.part" (`part.type`
 *   "text" is the model's text, "think" its thinking), "tool.call" (a tool
 *   use) and "step.end" (the end of one model response);
 * - `context.append_message` records **without** a time: protocol 1.0 / a
 *   session migrated from the Python kimi-cli, where `message.role` /
 *   `message.content` say the conversation directly. Kimi Code's own
 *   `context.append_message` records carry a time and repeat the loop events,
 *   so they are passed over.
 *
 * Older 1.0 records carry no time at all; their messages are laid out one
 * second apart from the session's createdAt. A session whose state.json has
 * no cwd/workDir takes the folder from `session_index.jsonl` at Kimi's root.
 *
 * A WSL distro home is scanned too: `<distro-home>/.kimi-code`.
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

const SOURCE = "kimi";
const DISPLAY_NAME = "Kimi Code";
const SESSIONS_DIR = "sessions";
/** Distro-home-relative location of Kimi Code's data folder. */
const WSL_RELATIVE = ".kimi-code";

// =============================================
// Raw file shapes
// =============================================

interface KimiState {
	title?: unknown;
	titleKind?: unknown;
	isCustomTitle?: unknown;
	customTitle?: unknown;
	cwd?: unknown;
	workDir?: unknown;
	createdAt?: unknown;
	updatedAt?: unknown;
	forkedFrom?: unknown;
}

interface KimiTextPart {
	type?: unknown;
	text?: unknown;
}

interface KimiContentPart {
	type?: unknown;
	text?: unknown;
	think?: unknown;
}

interface KimiWireEvent {
	type?: unknown;
	part?: KimiContentPart;
}

interface KimiWireMessage {
	role?: unknown;
	content?: unknown;
	toolCalls?: unknown;
}

interface KimiWireLine {
	type?: unknown;
	time?: unknown;
	input?: unknown;
	origin?: {
		kind?: unknown;
	};
	event?: KimiWireEvent;
	message?: KimiWireMessage;
}

// =============================================
// Paths
// =============================================

function getDataDir(): string {
	return appConfig.kimiDataDir;
}

/** The Windows-local install plus every WSL distro home with `.kimi-code`. */
function kimiRoots(): string[] {
	return withWslRoots(getDataDir(), WSL_RELATIVE);
}

function sessionsDirFor(root: string): string {
	return resolve(root, SESSIONS_DIR);
}

// =============================================
// state.json / session_index.jsonl
// =============================================

function stringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

async function readState(sessionDir: string): Promise<KimiState | null> {
	try {
		const raw = JSON.parse(
			await readFile(resolve(sessionDir, "state.json"), "utf-8"),
		) as unknown;
		if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
			return null;
		}
		return raw as KimiState;
	} catch {
		// Missing or half-written state: the wire file is still readable.
		return null;
	}
}

/** A state.json date: epoch milliseconds since 1.5, RFC 3339 before. */
function stateTimeMs(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		return Number.isNaN(parsed) ? null : parsed;
	}
	return null;
}

/** The folder the session ran in: `cwd`, or `workDir` before protocol 1.5. */
function stateCwd(state: KimiState | null): string {
	return stringField(state?.cwd) || stringField(state?.workDir);
}

/** The session's name: a user-given title, else Kimi's own, else legacy title. */
function stateTitle(state: KimiState | null): string {
	return stringField(state?.title) || stringField(state?.customTitle);
}

interface KimiIndexCache {
	mtimeMs: number;
	size: number;
	workDirs: Map<string, string>;
}

/** Cache of `session_index.jsonl`, invalidated by mtime. */
const indexCache = new Map<string, KimiIndexCache>();

/**
 * The working directory `session_index.jsonl` gives a session, for an early
 * state.json that names none. "" when the index is missing or has no line for
 * the session.
 */
async function indexedWorkDir(
	root: string,
	sessionId: string,
): Promise<string> {
	const indexPath = resolve(root, "session_index.jsonl");
	const indexStat = await stat(indexPath).catch(() => null);
	if (!indexStat?.isFile()) {
		indexCache.delete(indexPath);
		return "";
	}

	let cache = indexCache.get(indexPath);
	if (
		!cache ||
		cache.mtimeMs !== indexStat.mtimeMs ||
		cache.size !== indexStat.size
	) {
		const workDirs = new Map<string, string>();
		let text = "";
		try {
			text = await readFile(indexPath, "utf8");
		} catch {
			return "";
		}
		for (const line of text.split("\n")) {
			if (!line.trim()) continue;
			try {
				const record = JSON.parse(line) as Record<string, unknown>;
				const id = stringField(record.sessionId);
				const workDir = stringField(record.workDir);
				if (id && workDir) workDirs.set(id, workDir);
			} catch {
				// Malformed index line: skip it.
			}
		}
		cache = { mtimeMs: indexStat.mtimeMs, size: indexStat.size, workDirs };
		indexCache.set(indexPath, cache);
	}

	return cache.workDirs.get(sessionId) ?? "";
}

// =============================================
// Misc helpers
// =============================================

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

/** A wire record's time: epoch ms (protocol 1.4+; ms is Kimi's own unit). */
function recordTimeMs(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		if (value <= 0) return null;
		return value > 1e11 ? value : value * 1000;
	}
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		return Number.isNaN(parsed) ? null : parsed;
	}
	return null;
}

/** The `text` values of a `turn.prompt` / `turn.steer` input array. */
function inputTexts(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const texts: string[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const part = item as KimiTextPart;
		if (part.type === "text" && typeof part.text === "string") {
			texts.push(part.text);
		}
	}
	return texts;
}

/** Text/thinking from a protocol 1.0 `context.append_message` content array. */
function protocolOneContent(content: unknown): {
	texts: string[];
	thinking: string[];
} {
	const texts: string[] = [];
	const thinking: string[] = [];
	if (typeof content === "string") {
		texts.push(content);
		return { texts, thinking };
	}
	if (!Array.isArray(content)) return { texts, thinking };
	for (const item of content) {
		if (!item || typeof item !== "object") continue;
		const part = item as KimiContentPart;
		if (part.type === "text" && typeof part.text === "string") {
			texts.push(part.text);
		} else if (part.type === "think") {
			if (typeof part.think === "string") thinking.push(part.think);
			else if (typeof part.text === "string") thinking.push(part.text);
		}
	}
	return { texts, thinking };
}

function hasToolCalls(message: KimiWireMessage | undefined): boolean {
	return Array.isArray(message?.toolCalls) && message.toolCalls.length > 0;
}

// =============================================
// Scanning
// =============================================

async function scanSessions(): Promise<ConversationMeta[]> {
	const metas: ConversationMeta[] = [];

	for (const root of kimiRoots()) {
		const sessionsDir = sessionsDirFor(root);

		let workdirDirs: Dirent[];
		try {
			workdirDirs = await readdir(sessionsDir, { withFileTypes: true });
		} catch {
			// A root may disappear while a WSL distro stops; keep the others.
			continue;
		}

		for (const workdirDir of workdirDirs) {
			if (!workdirDir.isDirectory()) continue;
			const workdirPath = resolve(sessionsDir, workdirDir.name);

			let sessionDirs: Dirent[];
			try {
				sessionDirs = await readdir(workdirPath, { withFileTypes: true });
			} catch {
				continue;
			}

			for (const sessionDirEntry of sessionDirs) {
				if (!sessionDirEntry.isDirectory()) continue;
				const sessionDir = resolve(workdirPath, sessionDirEntry.name);
				const filePath = resolve(sessionDir, "agents", "main", "wire.jsonl");

				const fileStat = await stat(filePath).catch(() => null);
				if (!fileStat?.isFile()) continue; // Subagent-only or empty session.

				const state = await readState(sessionDir);
				// Fold state.json into the meta so a retitled session imports.
				const times = { size: fileStat.size, mtime: fileStat.mtime };
				const stateStat = await stat(resolve(sessionDir, "state.json")).catch(
					() => null,
				);
				if (stateStat?.isFile()) {
					times.size += stateStat.size;
					if (stateStat.mtime > times.mtime) times.mtime = stateStat.mtime;
				}

				const projectDir =
					stateCwd(state) ||
					(await indexedWorkDir(root, sessionDirEntry.name));

				metas.push({
					id: sessionDirEntry.name,
					source: SOURCE,
					filePath,
					fileSize: times.size,
					fileMtime: times.mtime.toISOString(),
					projectDir,
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

async function parseSession(meta: ConversationMeta): Promise<ParsedConversation> {
	const conversationId = meta.id;
	// <session>/agents/main/wire.jsonl → the session folder.
	const sessionDir = dirname(dirname(dirname(meta.filePath)));
	const state = await readState(sessionDir);
	const projectDir = stateCwd(state) || meta.projectDir || "";

	const fallbackMs = (() => {
		const parsed = Date.parse(meta.fileMtime);
		return Number.isNaN(parsed) ? Date.now() : parsed;
	})();
	const createdMs = stateTimeMs(state?.createdAt);
	const baseMs = createdMs ?? fallbackMs;

	let fileText = "";
	try {
		fileText = await readFile(meta.filePath, "utf8");
	} catch {
		fileText = "";
	}

	const messages: ParsedMessage[] = [];
	let lastKnownMs = baseMs - 1000;
	let lastEmittedMs = Number.NEGATIVE_INFINITY;

	const emitMessage = (
		role: "user" | "assistant",
		content: string,
		thinking: string | null,
		hasToolUse: boolean,
		startMs: number | null,
	): void => {
		const candidate =
			startMs !== null ? startMs : lastKnownMs + 1000;
		const timestamp = Math.max(candidate, lastEmittedMs + 1);
		lastEmittedMs = timestamp;
		lastKnownMs = Math.max(lastKnownMs, timestamp);
		messages.push({
			id: `${conversationId}-${messages.length}`,
			parentUuid: null,
			type: role,
			role,
			content,
			hasToolUse,
			hasCode: content.includes("```"),
			thinking,
			timestamp: new Date(timestamp).toISOString(),
		});
	};

	let pendingUser: { texts: string[]; startMs: number | null } | null = null;
	let assistant = { texts: [] as string[], thinking: [] as string[], hasToolUse: false, startMs: null as number | null };

	const flushUser = (): void => {
		if (!pendingUser) return;
		const { texts, startMs } = pendingUser;
		pendingUser = null;
		const content = texts.join("\n").trim();
		if (!content) return;
		emitMessage("user", content, null, false, startMs);
	};

	const flushAssistant = (): void => {
		const content = assistant.texts.join("\n").trim();
		const thinking = assistant.thinking.join("\n").trim();
		const { hasToolUse, startMs } = assistant;
		assistant = {
			texts: [],
			thinking: [],
			hasToolUse: false,
			startMs: null,
		};
		if (!content && !thinking && !hasToolUse) return;
		emitMessage("assistant", content, thinking || null, hasToolUse, startMs);
	};

	for (const line of fileText.split("\n")) {
		if (!line.trim()) continue;

		let parsed: KimiWireLine;
		try {
			parsed = JSON.parse(line) as KimiWireLine;
		} catch {
			continue; // Skip malformed lines, keep the rest of the session.
		}
		if (!parsed || typeof parsed !== "object") continue;

		const lineMs = recordTimeMs(parsed.time);
		const type = stringField(parsed.type);

		if (type === "turn.prompt" || type === "turn.steer") {
			// A prompt whose origin is not the user is a skill activation, a
			// background task's news or a subagent's task, not typed text.
			if (stringField(parsed.origin?.kind) !== "user") continue;
			flushAssistant();
			flushUser();
			const texts = inputTexts(parsed.input);
			if (texts.length === 0) continue;
			pendingUser = { texts, startMs: lineMs };
			continue;
		}

		if (type === "context.append_loop_event") {
			const event = parsed.event;
			if (!event || typeof event !== "object") continue;
			const eventType = stringField(event.type);

			if (eventType === "content.part") {
				flushUser();
				const part = event.part;
				if (!part) continue;
				const partType = stringField(part.type);
				if (partType === "text" && typeof part.text === "string") {
					assistant.texts.push(part.text);
					assistant.startMs ??= lineMs;
				} else if (partType === "think" && typeof part.think === "string") {
					assistant.thinking.push(part.think);
					assistant.startMs ??= lineMs;
				}
				continue;
			}

			if (eventType === "tool.call") {
				flushUser();
				assistant.hasToolUse = true;
				assistant.startMs ??= lineMs;
				continue;
			}

			if (eventType === "step.end") {
				flushUser();
				flushAssistant();
			}
			continue;
		}

		if (type === "context.append_message") {
			// Kimi Code's own append_message records carry a time and repeat the
			// loop events; only the timeless protocol 1.0 records say the
			// conversation directly.
			if (lineMs !== null) continue;
			const message = parsed.message;
			if (!message || typeof message !== "object") continue;
			const role = stringField(message.role);
			if (role !== "user" && role !== "assistant") continue;

			flushAssistant();
			flushUser();
			const { texts, thinking } = protocolOneContent(message.content);
			const content = texts.join("\n").trim();
			const thinkingText = thinking.join("\n").trim();
			const hasToolUse = role === "assistant" && hasToolCalls(message);
			if (!content && !thinkingText && !hasToolUse) continue;
			emitMessage(role, content, thinkingText || null, hasToolUse, null);
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
		slug: truncateSlug(stateTitle(state) || firstUserText),
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
// Kimi Code Adapter
// =============================================

export const kimiAdapter: SourceAdapter = {
	name: SOURCE,
	displayName: DISPLAY_NAME,
	parserVersion: "kimi@1",

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
		// The session id is its folder name; `agents/main/wire.jsonl` is the main
		// conversation and state.json beside `agents/` names it. The main agent
		// only: a subagent's wire file is not a conversation of its own here.
		return parseSession(meta);
	},

	watchPaths(): string[] {
		const sessionsDir = sessionsDirFor(getDataDir());
		if (!existsSync(sessionsDir)) return [];
		// Only the Windows-local store is watched: `\\wsl.localhost` paths are
		// slow and may start a stopped distro. WSL conversations sync on the next
		// manual Import.
		return [resolve(sessionsDir, "**", "wire.jsonl")];
	},
};
