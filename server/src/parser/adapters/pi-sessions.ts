/**
 * Shared reader for Pi coding-agent session transcripts.
 *
 * Pi and the harnesses that embed it (omp, Raft, Cindy) write one JSONL file
 * per session, named `<time>_<session id>.jsonl`:
 *
 *   {"type":"session","version":3,"id":"...","cwd":"...","timestamp":"..."}
 *   {"type":"message","id":"...","parentId":"...","timestamp":"...",
 *    "message":{"role":"user"|"assistant","content":string|Part[]}}
 *   {"type":"session_info","name":"..."}      Pi's title
 *   {"type":"title_change","title":"..."}     omp's title updates
 *   {"type":"model_change"|"thinking_level_change"|"usage"|"compaction"|...}
 *
 * An assistant message's content is a list of parts: `{type:"text"}`,
 * `{type:"thinking"}` and `{type:"toolCall",name,arguments}`. `toolResult`
 * messages, `usage` / `model_change` / `compaction` records and the other
 * bookkeeping entries are not conversation history.
 *
 * This module holds the pieces every Pi-family adapter shares: listing the
 * `<time>_<id>.jsonl` files of a folder (flat, or in one folder per cwd),
 * parsing one transcript into ChatCrystal messages, and turning that into a
 * `ParsedConversation`. Timestamps are taken from a record's `timestamp`
 * (ISO-8601 or epoch milliseconds), falling back to the file mtime.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import { basename, resolve } from "node:path";
import type {
	ConversationMeta,
	ParsedConversation,
	ParsedMessage,
} from "@chatcrystal/shared";

/** A `<time>_<session id>.jsonl` session file found on disk. */
export interface PiSessionFile {
	/** Session id: the part after the first `_` of the file name. */
	id: string;
	filePath: string;
	fileSize: number;
	fileMtime: string;
	/** Encoded cwd folder the file lives in; "" for a flat session folder. */
	projectDir: string;
}

/** Where Pi-family sessions are looked for. */
export interface PiSessionLocation {
	/** Folder to read session files from. */
	dir: string;
	/**
	 * `project` when the folder holds one sub folder per cwd (Pi's
	 * `sessions/<cwd>/<time>_<id>.jsonl`), `flat` when the session files lie
	 * directly in it (omp profiles aside, Raft, Cindy, a custom session dir).
	 */
	layout: "project" | "flat";
	/** Root folder recorded on the resulting `ConversationMeta`. */
	rootDir: string;
}

/** A `PiSessionFile` together with the adapter root it was found under. */
export interface LocatedPiSession extends PiSessionFile {
	rootDir: string;
}

/** What one Pi-format transcript says, before adapter-specific metadata. */
export interface ParsedPiSession {
	cwd: string | null;
	title: string | null;
	messages: ParsedMessage[];
	/** Time recorded by the session header, if it has one. */
	headerTimestamp: string | null;
}

/** Content part of a Pi message (text, thinking or toolCall). */
interface PiContentPart {
	type?: string;
	text?: string;
	thinking?: string;
	name?: string;
}

interface PiRecordMessage {
	role?: string;
	content?: unknown;
	timestamp?: unknown;
	/** A tool result that ran model work of its own (e.g. a codemode script). */
	nestedCalls?: { calls?: Array<{ name?: string }> };
}

interface PiRecord {
	type?: string;
	id?: string;
	parentId?: string | null;
	timestamp?: unknown;
	cwd?: string;
	/** Session header title (omp writes one) and title_change's new title. */
	title?: string;
	/** session_info's name. */
	name?: string;
	message?: PiRecordMessage;
}

// =============================================
// File discovery
// =============================================

/**
 * Session id from a Pi session file name, `<time>_<session id>.jsonl`, or
 * null for names that are not Pi sessions (sidecar files in a session's
 * artifact folder, for instance).
 */
export function piSessionIdFromFileName(fileName: string): string | null {
	if (!fileName.endsWith(".jsonl")) return null;
	const stem = fileName.slice(0, -".jsonl".length);
	const separator = stem.indexOf("_");
	if (separator <= 0) return null;
	const id = stem.slice(separator + 1);
	if (!id || id.startsWith("_")) return null;
	return id;
}

/** Session files directly in `dir` (used by Raft, Cindy and custom session dirs). */
export async function listPiSessionFiles(
	dir: string,
): Promise<PiSessionFile[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const files: PiSessionFile[] = [];
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const id = piSessionIdFromFileName(entry.name);
		if (!id) continue;

		const filePath = resolve(dir, entry.name);
		let fileStat: Stats;
		try {
			fileStat = await stat(filePath);
		} catch {
			continue;
		}

		files.push({
			id,
			filePath,
			fileSize: fileStat.size,
			fileMtime: fileStat.mtime.toISOString(),
			projectDir: "",
		});
	}
	return files;
}

/**
 * Session files one project folder below `sessionsRoot`, Pi's default layout
 * `sessions/<cwd>/<time>_<session id>.jsonl`.
 */
export async function listPiProjectSessions(
	sessionsRoot: string,
): Promise<PiSessionFile[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(sessionsRoot, { withFileTypes: true });
	} catch {
		return [];
	}

	const files: PiSessionFile[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		const projectDir = entry.name;
		const projectFiles = await listPiSessionFiles(
			resolve(sessionsRoot, entry.name),
		);
		for (const file of projectFiles) {
			files.push({ ...file, projectDir });
		}
	}
	return files;
}

/** Deduplicate by file path (case-insensitively on Windows), keeping the first. */
function fileKey(filePath: string): string {
	return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

/**
 * Read every session file of a Pi-family source from all of its locations.
 * A single unreadable location (a WSL distro stopping mid-scan, for instance)
 * is skipped so the other roots still import.
 */
export async function collectPiSessions(
	locations: PiSessionLocation[],
): Promise<LocatedPiSession[]> {
	const seen = new Set<string>();
	const sessions: LocatedPiSession[] = [];

	for (const location of locations) {
		let files: PiSessionFile[];
		try {
			files =
				location.layout === "project"
					? await listPiProjectSessions(location.dir)
					: await listPiSessionFiles(location.dir);
		} catch {
			continue;
		}

		for (const file of files) {
			const key = fileKey(file.filePath);
			if (seen.has(key)) continue;
			seen.add(key);
			sessions.push({ ...file, rootDir: location.rootDir });
		}
	}
	return sessions;
}

// =============================================
// Transcript parsing
// =============================================

/** ISO-8601 string or epoch milliseconds (seconds tolerated), null if unusable. */
function normalizePiTimestamp(value: unknown): string | null {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return epochToIso(value);
	}
	if (typeof value === "string" && value.trim()) {
		const trimmed = value.trim();
		const numeric = Number(trimmed);
		if (Number.isFinite(numeric) && numeric > 0) return epochToIso(numeric);
		const parsed = Date.parse(trimmed);
		return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
	}
	return null;
}

function epochToIso(value: number): string | null {
	// Pi writes milliseconds; tolerate a seconds value from an older build.
	const millis = value < 1e11 ? value * 1000 : value;
	const date = new Date(millis);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Text, thinking and tool-use flags of a message's content, which is either a
 * plain string (older Pi) or a list of typed parts.
 */
function extractPiContent(content: unknown): {
	text: string;
	thinking: string | null;
	hasToolUse: boolean;
	hasCode: boolean;
} {
	if (typeof content === "string") {
		const text = content.trim();
		return {
			text,
			thinking: null,
			hasToolUse: false,
			hasCode: text.includes("```"),
		};
	}
	if (!Array.isArray(content)) {
		return { text: "", thinking: null, hasToolUse: false, hasCode: false };
	}

	const texts: string[] = [];
	const thinkingParts: string[] = [];
	let hasToolUse = false;

	for (const part of content) {
		if (typeof part === "string") {
			texts.push(part);
			continue;
		}
		if (!part || typeof part !== "object") continue;
		const typed = part as PiContentPart;
		switch (typed.type) {
			case "text":
				if (typeof typed.text === "string" && typed.text) {
					texts.push(typed.text);
				}
				break;
			case "thinking":
			case "reasoning":
				// Pi writes {type:"thinking", thinking}; tolerate a text field.
				if (typeof typed.thinking === "string" && typed.thinking) {
					thinkingParts.push(typed.thinking);
				} else if (typeof typed.text === "string" && typed.text) {
					thinkingParts.push(typed.text);
				}
				break;
			case "toolCall":
			case "tool_call":
			case "tool_use":
				hasToolUse = true;
				break;
			default:
				break;
		}
	}

	const text = texts.join("\n").trim();
	return {
		text,
		thinking: thinkingParts.length > 0 ? thinkingParts.join("\n") : null,
		hasToolUse,
		hasCode: text.includes("```"),
	};
}

function messageIdOf(
	record: PiRecord,
	fileStem: string,
	messageCount: number,
): string {
	const id = typeof record.id === "string" ? record.id.trim() : "";
	return id || `${fileStem}-msg-${messageCount + 1}`;
}

function parentIdOf(record: PiRecord): string | null {
	return typeof record.parentId === "string" && record.parentId
		? record.parentId
		: null;
}

/**
 * Read one Pi-format JSONL transcript. Only user and assistant messages are
 * kept; tool calls flag their assistant message, thinking parts are collected
 * into `thinking`, and the title is the last `session_info` / `title_change` /
 * header title recorded. Messages are returned in timestamp order.
 */
export async function parsePiSessionFile(
	filePath: string,
	fallbackIso: string,
): Promise<ParsedPiSession> {
	const fileStem = basename(filePath, ".jsonl");
	let raw = "";
	try {
		raw = await readFile(filePath, "utf-8");
	} catch {
		raw = "";
	}

	let cwd: string | null = null;
	let title: string | null = null;
	let headerTimestamp: string | null = null;
	let hasHeader = false;
	let lastAssistant: ParsedMessage | null = null;
	const messages: ParsedMessage[] = [];

	for (const rawLine of raw.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;

		let record: PiRecord;
		try {
			record = JSON.parse(line) as PiRecord;
		} catch {
			// A truncated trailing line after an interrupted write.
			continue;
		}
		if (!record || typeof record !== "object") continue;

		switch (record.type) {
			case "session": {
				// omp writes a fixed-width title line before the header; the
				// header is still the record that names the session.
				if (hasHeader) break;
				hasHeader = true;
				if (typeof record.cwd === "string" && record.cwd.trim()) {
					cwd = record.cwd.trim();
				}
				if (typeof record.title === "string" && record.title.trim()) {
					title = record.title.trim();
				}
				headerTimestamp = normalizePiTimestamp(record.timestamp);
				break;
			}
			case "session_info": {
				if (typeof record.name === "string" && record.name.trim()) {
					title = record.name.trim();
				}
				break;
			}
			case "title":
			case "title_change": {
				if (typeof record.title === "string" && record.title.trim()) {
					title = record.title.trim();
				}
				break;
			}
			case "message": {
				const payload = record.message;
				if (!payload || typeof payload !== "object") break;
				const role = typeof payload.role === "string" ? payload.role : "";
				const timestamp =
					normalizePiTimestamp(record.timestamp) ??
					normalizePiTimestamp(payload.timestamp) ??
					fallbackIso;
				const content = extractPiContent(payload.content);

				if (role === "user") {
					// User content may echo a tool result (only tool_result parts);
					// those are noise, not a prompt.
					if (!content.text) break;
					messages.push({
						id: messageIdOf(record, fileStem, messages.length),
						parentUuid: parentIdOf(record),
						type: "user",
						role: "user",
						content: content.text,
						hasToolUse: false,
						hasCode: content.hasCode,
						thinking: null,
						timestamp,
					});
					break;
				}

				if (role === "assistant") {
					if (!content.text && !content.thinking && !content.hasToolUse) break;
					const message: ParsedMessage = {
						id: messageIdOf(record, fileStem, messages.length),
						parentUuid: parentIdOf(record),
						type: "assistant",
						role: "assistant",
						content: content.text,
						hasToolUse: content.hasToolUse,
						hasCode: content.hasCode,
						thinking: content.thinking,
						timestamp,
					};
					messages.push(message);
					lastAssistant = message;
					break;
				}

				// Tool results and other roles are bookkeeping, but a tool that
				// called tools in turn keeps its caller a tool-using turn.
				const nestedCalls = payload.nestedCalls?.calls;
				if (
					lastAssistant &&
					Array.isArray(nestedCalls) &&
					nestedCalls.length > 0
				) {
					lastAssistant.hasToolUse = true;
				}
				break;
			}
			default:
				// model_change, thinking_level_change, usage, compaction,
				// branch_summary, custom, ... are not conversation turns.
				break;
		}
	}

	messages.sort(
		(a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
	);

	return { cwd, title, messages, headerTimestamp };
}

// =============================================
// Conversation assembly
// =============================================

/** Last path segment of a cwd, accepting both Windows and POSIX separators. */
function projectNameFromPath(path: string): string {
	const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? "";
}

/**
 * Best-effort decode of Pi's encoded cwd folder name (`--home-me-app--` for
 * `/home/me/app`, `--C--Users-me-app--` for `C:\Users\me\app`), used only when
 * a transcript's header records no cwd.
 */
export function decodePiProjectFolder(folderName: string): string {
	if (!folderName.trim()) return "";
	const inner = folderName.trim().replace(/^-+/, "").replace(/-+$/, "");
	if (!inner) return "";
	if (/^[A-Za-z]--/.test(inner)) {
		const drive = inner[0].toUpperCase();
		const segments = inner
			.slice(3)
			.split("-")
			.filter((segment) => segment.length > 0);
		return `${drive}:\\${segments.join("\\")}`;
	}
	const segments = inner.split("-").filter(Boolean);
	if (segments.length === 0) return "";
	return `/${segments.join("/")}`;
}

/**
 * Build the `ParsedConversation` of one Pi-family session. The cwd recorded in
 * the header is authoritative; without one, the encoded cwd folder of the
 * scan location is decoded and `defaultProjectName` used if even that fails.
 */
export function toParsedConversation(
	source: string,
	meta: ConversationMeta,
	parsed: ParsedPiSession,
	defaultProjectName: string,
): ParsedConversation {
	const cwd = parsed.cwd;
	const projectDir = cwd ?? decodePiProjectFolder(meta.projectDir);
	const fallbackTimestamp =
		parsed.headerTimestamp ?? (meta.fileMtime || new Date().toISOString());

	return {
		id: meta.id,
		slug: parsed.title,
		source,
		projectDir,
		projectName: projectNameFromPath(projectDir) || defaultProjectName,
		cwd,
		gitBranch: null,
		messages: parsed.messages,
		firstMessageAt: parsed.messages[0]?.timestamp ?? fallbackTimestamp,
		lastMessageAt:
			parsed.messages[parsed.messages.length - 1]?.timestamp ??
			fallbackTimestamp,
	};
}
