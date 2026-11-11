/**
 * Continue adapter.
 *
 * Continue (VS Code / JetBrains extension and `cn` CLI) keeps a whole-file
 * JSON document per chat under `<continueDataDir>/sessions/<sessionId>.json`
 * and an index of them in `<continueDataDir>/sessions.json`:
 *
 * - Session document: `{ title?, workspaceDirectory?, dateCreated?,
 *   history: [{ message: { role, content }, toolCallStates? }] }`, where
 *   `content` is a string or an array of `{ type: 'text', text }` parts.
 * - Index: an array (or `{ sessions: [...] }`) of
 *   `{ sessionId | id, dateCreated, workspaceDirectory | workspace }`.
 *
 * `system` and `tool` roles are skipped: the first is configuration and a
 * tool's output arrives under the assistant item that asked for it. Session
 * files carry no per-message timestamps, so turns are laid out one second
 * apart from the index's `dateCreated` (falling back to the file's mtime).
 *
 * The same layout also exists inside a WSL distro home (`~/.continue`), so
 * every root is scanned; `meta.rootDir` tells `parse()` which root's
 * `sessions.json` index to read.
 */

import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type {
	ConversationMeta,
	ParsedConversation,
	ParsedMessage,
	SourceInfo,
} from "@chatcrystal/shared";
import { appConfig } from "../../config.js";
import type { SourceAdapter } from "../adapter.js";
import { withWslRoots } from "../sourceRoots.js";
import {
	asArrayField,
	decodeFileUri,
	extractContentText,
	projectNameFromDir,
	readJsonFile,
	toEpochMs,
	toRecord,
	truncateSlug,
} from "./vscode-tasks.js";

// =============================================
// Index types / cache
// =============================================

interface ContinueSessionIndexEntry {
	id: string;
	dateCreated: string | number | null;
	workspaceDirectory: string;
}

interface ContinueIndexCache {
	mtimeMs: number;
	entries: Map<string, ContinueSessionIndexEntry>;
}

/**
 * Cache of each root's `sessions.json`, keyed by index path and invalidated by
 * mtime. Per-root so scanning several roots does not evict each other.
 */
const sessionIndexCache = new Map<string, ContinueIndexCache>();

// =============================================
// Paths
// =============================================

/** Distro-home-relative location of Continue's data folder (`~/.continue`). */
const WSL_RELATIVE = ".continue";

/** The local `~/.continue` plus every WSL distro home that has one. */
function dataRoots(): string[] {
	return withWslRoots(appConfig.continueDataDir, WSL_RELATIVE);
}

/** The Windows-local sessions folder; only the watcher uses it. */
function getLocalSessionsDir(): string {
	return resolve(appConfig.continueDataDir, "sessions");
}

// =============================================
// Session index
// =============================================

async function loadSessionIndex(
	dataRoot: string,
): Promise<Map<string, ContinueSessionIndexEntry>> {
	const indexPath = resolve(dataRoot, "sessions.json");
	const indexStat = await stat(indexPath).catch(() => null);
	if (!indexStat?.isFile()) {
		sessionIndexCache.delete(indexPath);
		return new Map();
	}
	const cached = sessionIndexCache.get(indexPath);
	if (cached && cached.mtimeMs === indexStat.mtimeMs) {
		return cached.entries;
	}

	const raw = await readJsonFile(indexPath);
	const entries = asArrayField(raw, ["sessions"]);
	const index = new Map<string, ContinueSessionIndexEntry>();
	for (const entry of entries) {
		const record = toRecord(entry);
		if (!record) continue;
		const id =
			typeof record.sessionId === "string"
				? record.sessionId
				: typeof record.id === "string"
					? record.id
					: null;
		if (!id) continue;
		const workspace =
			typeof record.workspaceDirectory === "string"
				? record.workspaceDirectory
				: typeof record.workspace === "string"
					? record.workspace
					: "";
		const dateCreated =
			typeof record.dateCreated === "number" ||
			typeof record.dateCreated === "string"
				? record.dateCreated
				: null;
		index.set(id, {
			id,
			dateCreated,
			workspaceDirectory: decodeFileUri(workspace),
		});
	}

	sessionIndexCache.set(indexPath, { mtimeMs: indexStat.mtimeMs, entries: index });
	return index;
}

// =============================================
// Scanning
// =============================================

async function scanSessions(): Promise<ConversationMeta[]> {
	const metas: ConversationMeta[] = [];
	for (const dataRoot of dataRoots()) {
		try {
			const sessionsDir = resolve(dataRoot, "sessions");
			const fileNames = await readdir(sessionsDir).catch(() => null);
			if (!fileNames) continue;

			const index = await loadSessionIndex(dataRoot);
			for (const fileName of fileNames.sort()) {
				if (!fileName.endsWith(".json")) continue;
				const filePath = resolve(sessionsDir, fileName);
				const fileStat = await stat(filePath).catch(() => null);
				if (!fileStat?.isFile()) continue;
				const id = basename(fileName, ".json");
				metas.push({
					id,
					source: "continue",
					filePath,
					fileSize: fileStat.size,
					fileMtime: fileStat.mtime.toISOString(),
					projectDir: index.get(id)?.workspaceDirectory ?? "",
					rootDir: dataRoot,
				});
			}
		} catch {
			// A root may disappear while a WSL distro stops; keep the others.
		}
	}
	return metas;
}

// =============================================
// Parsing
// =============================================

async function parseSession(meta: ConversationMeta): Promise<ParsedConversation> {
	const session = toRecord(await readJsonFile(meta.filePath));
	const history = asArrayField(session?.history, []);
	// The `sessions.json` index lives at the root the session was scanned from;
	// a WSL session must not read the Windows root's index.
	const dataRoot = meta.rootDir ?? appConfig.continueDataDir;
	const indexEntry = (await loadSessionIndex(dataRoot)).get(meta.id);

	const baseMs =
		toEpochMs(indexEntry?.dateCreated) ??
		toEpochMs(session?.dateCreated) ??
		toEpochMs(meta.fileMtime) ??
		new Date().getTime();

	const messages: ParsedMessage[] = [];
	let firstUserText: string | null = null;

	for (const entry of history) {
		const item = toRecord(entry);
		if (!item) continue;
		const message = toRecord(item.message);
		if (!message) continue;
		const role = message.role;
		// `system` is configuration and `tool` output is attached to the
		// assistant item that requested it; neither is part of the thread.
		if (role !== "user" && role !== "assistant") continue;

		const extraction = extractContentText(message.content);
		// Continue keeps tool calls beside the message on the history item;
		// accept the message-level field too for older/CLI document shapes.
		const toolCallStates = item.toolCallStates ?? message.toolCallStates;
		const hasToolUse =
			Array.isArray(toolCallStates) && toolCallStates.length > 0;
		if (!extraction.text && extraction.thinking === null && !hasToolUse) {
			continue;
		}
		if (role === "user" && firstUserText === null && extraction.text) {
			firstUserText = extraction.text;
		}

		messages.push({
			id: `${meta.id}-${messages.length}`,
			parentUuid: null,
			type: role,
			role,
			content: extraction.text,
			hasToolUse,
			hasCode: extraction.hasCode,
			thinking: extraction.thinking,
			timestamp: new Date(baseMs + messages.length * 1000).toISOString(),
		});
	}

	const documentWorkspace =
		typeof session?.workspaceDirectory === "string"
			? decodeFileUri(session.workspaceDirectory)
			: "";
	const projectDir =
		documentWorkspace || indexEntry?.workspaceDirectory || meta.projectDir;
	const title = typeof session?.title === "string" ? session.title : "";
	const fallbackIso = new Date(baseMs).toISOString();

	return {
		id: meta.id,
		slug: truncateSlug(title || firstUserText || ""),
		source: "continue",
		projectDir,
		projectName: projectNameFromDir(projectDir),
		cwd: projectDir || null,
		gitBranch: null,
		messages,
		firstMessageAt: messages[0]?.timestamp ?? fallbackIso,
		lastMessageAt: messages[messages.length - 1]?.timestamp ?? fallbackIso,
	};
}

// =============================================
// Continue Adapter
// =============================================

export const continueAdapter: SourceAdapter = {
	name: "continue",
	displayName: "Continue",
	parserVersion: "continue@2",

	async detect(): Promise<SourceInfo | null> {
		try {
			const conversations = await scanSessions();
			if (conversations.length === 0) return null;
			return {
				name: "continue",
				displayName: "Continue",
				// The primary root stays first even when only WSL sessions exist.
				dataDir: appConfig.continueDataDir,
				conversationCount: conversations.length,
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
		// Only the local Windows store: `\\wsl.localhost` paths are slow and may
		// start a stopped distro. WSL conversations sync on the next manual Import.
		const sessionsDir = getLocalSessionsDir();
		if (!existsSync(sessionsDir)) return [];
		return [resolve(sessionsDir, "*.json")];
	},
};
