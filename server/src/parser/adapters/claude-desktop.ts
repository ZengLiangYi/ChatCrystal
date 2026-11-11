/**
 * Claude Desktop adapter (Claude Code / Cowork local-agent sessions).
 *
 * Claude Desktop (Claude.app) keeps its Cowork / local-agent conversations as
 * Claude Code style transcripts inside its data folder (`%APPDATA%\Claude` on
 * Windows, `~/Library/Application Support/Claude` on macOS,
 * `$CLAUDE_DESKTOP_DATA_DIR` overrides):
 *
 *   <dataDir>/local-agent-mode-sessions/<account>/<org>/local_<id>/.claude/
 *       projects/<mangled-cwd>/<sessionId>.jsonl
 *
 * Cowork gives every local session its own Claude Code home under the
 * `local_<id>` folder (`<home>/projects/<mangled>/<session>.jsonl`), so the
 * transcripts are Claude Code's own JSONL and parsing is delegated to the
 * Claude Code adapter, with the `source` changed to `claude-desktop`.
 *
 * The sibling `<local_<id>>.json` metadata files Desktop keeps next to those
 * folders (`sessionId`, `cliSessionId`, `priorCliSessionIds`, `title`) supply
 * the human-readable session name when the transcript carries none.
 *
 * `claude-code-sessions/` is Desktop's other per-account store (today it holds
 * metadata JSON for Code mode; its transcripts live in `~/.claude/projects`).
 * It is scanned with the same conservative discovery so a future Desktop build
 * that writes transcripts there is picked up, and no `local_*.json` is ever
 * mistaken for a transcript.
 *
 * This is a desktop application: its stores live under the OS config folder, so
 * there are no WSL counterparts to scan (the code keeps the same per-root shape
 * as the other adapters).
 */

import { existsSync, type Dirent, type Stats } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import type {
	ConversationMeta,
	ParsedConversation,
	SourceInfo,
} from "@chatcrystal/shared";
import { appConfig } from "../../config.js";
import type { SourceAdapter } from "../adapter.js";
import { claudeCodeAdapter } from "./claude-code.js";

const SOURCE_NAME = "claude-desktop";
const DISPLAY_NAME = "Claude Desktop";
const PARSER_VERSION = "claude-desktop@1";

/** Desktop's two per-account session stores, both scanned conservatively. */
const DESKTOP_SESSION_DIRS = [
	"local-agent-mode-sessions",
	"claude-code-sessions",
] as const;

/** Bounded recursion: account / org folders add depth the layout may change on. */
const MAX_DISCOVERY_DEPTH = 6;

/** Folders that never hold a Cowork Claude home but can be very large. */
const SKIPPED_DIR_NAMES = new Set([
	"node_modules",
	"skills-plugin",
	"Cache",
	"Code Cache",
	"GPUCache",
	"CachedData",
	"logs",
]);

/** Files smaller than this cannot hold a JSON line and are skipped. */
const MIN_TRANSCRIPT_BYTES = 2;

/** Metadata JSON files larger than this are not Desktop's local_*.json. */
const MAX_METADATA_BYTES = 8 * 1024 * 1024;

/** How much of a transcript's tail is inspected for a title record. */
const TITLE_TAIL_BYTES = 512 * 1024;

/** The Desktop data folder (a getter so tests can point appConfig around). */
function desktopRoot(): string {
	return resolve(appConfig.claudeDesktopDataDir);
}

/** Dirent for a real directory, or for a symlink that resolves to one. */
async function isDirectoryEntry(
	path: string,
	entry: Dirent,
): Promise<boolean> {
	if (entry.isDirectory()) return true;
	if (!entry.isSymbolicLink()) return false;
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

/** Dirent for a regular file, or for a symlink that resolves to one. */
async function isFileEntry(path: string, entry: Dirent): Promise<boolean> {
	if (entry.isFile()) return true;
	if (!entry.isSymbolicLink()) return false;
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

/**
 * Find the Claude Code homes (`<…>/.claude`, each with a `projects/` folder)
 * below one of Desktop's session stores. The account/org folder depth is
 * walked rather than hardcoded so a Desktop update cannot hide the sessions;
 * the walk is bounded and skips the large non-session folders.
 */
async function findClaudeHomes(baseDir: string): Promise<string[]> {
	const homes: string[] = [];

	async function walk(dir: string, depth: number): Promise<void> {
		if (depth > MAX_DISCOVERY_DEPTH) return;

		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (!(await isDirectoryEntry(resolve(dir, entry.name), entry))) continue;
			if (SKIPPED_DIR_NAMES.has(entry.name)) continue;
			// Dot folders hold no Claude home; `.claude` is handled below.
			if (entry.name.startsWith(".") && entry.name !== ".claude") continue;

			const child = resolve(dir, entry.name);
			if (entry.name === ".claude") {
				if (existsSync(resolve(child, "projects"))) homes.push(child);
				continue;
			}
			await walk(child, depth + 1);
		}
	}

	await walk(baseDir, 0);
	return homes;
}

/** Session transcripts below one Claude home's `projects/` folder. */
async function collectClaudeHome(
	home: string,
	rootDir: string,
): Promise<ConversationMeta[]> {
	const projectsDir = resolve(home, "projects");
	if (!existsSync(projectsDir)) return [];

	let projectEntries: Dirent[];
	try {
		projectEntries = await readdir(projectsDir, { withFileTypes: true });
	} catch {
		return [];
	}

	const metas: ConversationMeta[] = [];
	for (const projectEntry of projectEntries) {
		const projectPath = resolve(projectsDir, projectEntry.name);
		if (!(await isDirectoryEntry(projectPath, projectEntry))) continue;
		if (projectEntry.name.startsWith(".")) continue;

		const mangledDir = projectEntry.name;

		let entries: Dirent[];
		try {
			entries = await readdir(projectPath, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			// Subagent transcripts sit below `<id>/subagents/`, not here.
			if (!entry.name.endsWith(".jsonl")) continue;
			const filePath = resolve(projectPath, entry.name);
			if (!(await isFileEntry(filePath, entry))) continue;

			let fileStat: Stats;
			try {
				fileStat = await stat(filePath);
			} catch {
				continue;
			}
			if (fileStat.size < MIN_TRANSCRIPT_BYTES) continue;

			metas.push({
				// Same convention as Claude Code: the file name is the session id.
				id: basename(entry.name, ".jsonl"),
				source: SOURCE_NAME,
				filePath,
				fileSize: fileStat.size,
				fileMtime: fileStat.mtime.toISOString(),
				projectDir: mangledDir,
				rootDir,
			});
		}
	}

	return metas;
}

/** Every transcript of every Desktop session store. */
async function collectSessionFiles(): Promise<ConversationMeta[]> {
	const root = desktopRoot();
	const metas: ConversationMeta[] = [];

	for (const kind of DESKTOP_SESSION_DIRS) {
		const baseDir = resolve(root, kind);
		if (!existsSync(baseDir)) continue;

		let homes: string[];
		try {
			homes = await findClaudeHomes(baseDir);
		} catch {
			continue;
		}
		for (const home of homes) {
			try {
				metas.push(...(await collectClaudeHome(home, root)));
			} catch {
				// One unreadable session folder must not hide the others.
			}
		}
	}

	// The two stores can be linked to the same tree; list each transcript once.
	const seen = new Set<string>();
	return metas.filter((meta) => {
		const key =
			process.platform === "win32"
				? resolve(meta.filePath).toLowerCase()
				: resolve(meta.filePath);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

// =============================================
// Session titles
// =============================================

interface ClaudeStyleTitleRecord {
	type?: string;
	aiTitle?: string;
	customTitle?: string;
}

/**
 * Read the newest `ai-title` / `custom-title` record from the tail of a
 * Claude Code style transcript (titles are appended as the session is named).
 */
async function readTranscriptTitle(filePath: string): Promise<string | null> {
	let handle: FileHandle | null = null;
	try {
		handle = await open(filePath, "r");
		const fileStat = await handle.stat();
		const length = Math.min(fileStat.size, TITLE_TAIL_BYTES);
		if (length <= 0) return null;

		const buffer = Buffer.alloc(length);
		const { bytesRead } = await handle.read(
			buffer,
			0,
			length,
			fileStat.size - length,
		);
		const lines = buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/);

		let aiTitle: string | null = null;
		let customTitle: string | null = null;
		for (let index = lines.length - 1; index >= 0; index--) {
			const line = lines[index] ?? "";
			if (!line.includes("Title")) continue;
			let record: ClaudeStyleTitleRecord;
			try {
				record = JSON.parse(line) as ClaudeStyleTitleRecord;
			} catch {
				continue; // The tail can start mid-line.
			}
			if (
				customTitle === null &&
				typeof record.customTitle === "string" &&
				record.customTitle.trim()
			) {
				customTitle = record.customTitle.trim();
			}
			if (
				aiTitle === null &&
				typeof record.aiTitle === "string" &&
				record.aiTitle.trim()
			) {
				aiTitle = record.aiTitle.trim();
			}
			if (customTitle !== null) break;
		}

		return customTitle ?? aiTitle;
	} catch {
		return null;
	} finally {
		await handle?.close().catch(() => {
			// best-effort close; nothing useful to do here
		});
	}
}

/**
 * Read the `title` of a Desktop metadata JSON, but only when it names this
 * transcript's CLI session (`cliSessionId` / `unarchivedCliSessionId` /
 * `preClearCliSessionId` / `sessionId` / `priorCliSessionIds`).
 */
async function readMetadataTitle(
	metadataPath: string,
	sessionId: string,
): Promise<string | null> {
	try {
		const fileStat = await stat(metadataPath);
		if (!fileStat.isFile() || fileStat.size > MAX_METADATA_BYTES) return null;

		const data = JSON.parse(await readFile(metadataPath, "utf8")) as Record<
			string,
			unknown
		>;
		const title = typeof data.title === "string" ? data.title.trim() : "";
		if (!title) return null;

		const ids: string[] = [];
		for (const key of [
			"cliSessionId",
			"unarchivedCliSessionId",
			"preClearCliSessionId",
			"sessionId",
		]) {
			const value = data[key];
			if (typeof value === "string" && value.trim()) ids.push(value.trim());
		}
		const prior = data.priorCliSessionIds;
		if (Array.isArray(prior)) {
			for (const value of prior) {
				if (typeof value === "string" && value.trim()) ids.push(value.trim());
			}
		}
		if (ids.length === 0) return title;

		const normalized = ids.map((id) =>
			id.startsWith("local_") ? id.slice("local_".length) : id,
		);
		return normalized.includes(sessionId) ? title : null;
	} catch {
		return null;
	}
}

/**
 * Look up the Desktop name of a session: the `local_<id>.json` record stored
 * next to the session's `local_<id>` folder, in the same store and in the other
 * store (Desktop keeps Code-mode names under `claude-code-sessions`).
 */
async function readDesktopSessionTitle(
	meta: ConversationMeta,
): Promise<string | null> {
	const root = resolve(meta.rootDir ?? appConfig.claudeDesktopDataDir);
	let relativePath: string;
	try {
		relativePath = relative(root, resolve(meta.filePath));
	} catch {
		return null;
	}
	if (!relativePath || relativePath.startsWith("..")) return null;

	const parts = relativePath.split(/[\\/]+/).filter(Boolean);
	const kindIndex = parts.findIndex((part) =>
		(DESKTOP_SESSION_DIRS as readonly string[]).includes(part),
	);
	if (kindIndex < 0) return null;

	let localIndex = -1;
	for (let index = parts.length - 1; index > kindIndex; index--) {
		if (parts[index]?.startsWith("local_")) {
			localIndex = index;
			break;
		}
	}
	if (localIndex < 0) return null;

	// <account>/<org>/local_<id> → <account>/<org>/local_<id>.json
	const segments = parts.slice(kindIndex + 1, localIndex + 1);
	const metadataSegments = segments.map((segment, index) =>
		index === segments.length - 1 ? `${segment}.json` : segment,
	);
	const metadataKinds = [
		parts[kindIndex],
		...DESKTOP_SESSION_DIRS.filter((kind) => kind !== parts[kindIndex]),
	];

	for (const kind of metadataKinds) {
		if (!kind) continue;
		const title = await readMetadataTitle(
			resolve(root, kind, ...metadataSegments),
			meta.id,
		);
		if (title) return title;
	}
	return null;
}

// =============================================
// Claude Desktop Adapter
// =============================================

export const claudeDesktopAdapter: SourceAdapter = {
	name: SOURCE_NAME,
	displayName: DISPLAY_NAME,
	parserVersion: PARSER_VERSION,

	async detect(): Promise<SourceInfo | null> {
		try {
			const metas = await collectSessionFiles();
			if (metas.length === 0) return null;
			return {
				name: SOURCE_NAME,
				displayName: DISPLAY_NAME,
				dataDir: desktopRoot(),
				conversationCount: metas.length,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		try {
			return await collectSessionFiles();
		} catch {
			return [];
		}
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		// Desktop sessions are Claude Code transcripts; only the source id and
		// the title fallback are ours.
		const parsed = await claudeCodeAdapter.parse(meta);
		let slug = parsed.slug;
		if (!slug) slug = await readTranscriptTitle(meta.filePath);
		if (!slug) slug = await readDesktopSessionTitle(meta);
		return { ...parsed, id: meta.id, slug, source: SOURCE_NAME };
	},

	watchPaths(): string[] {
		// Only the local folder is watched: chokidar cannot watch UNC paths and
		// touching a stopped WSL distro would start it. WSL sessions are picked
		// up by the next manual Import.
		const root = desktopRoot();
		if (!existsSync(root)) return [];
		return DESKTOP_SESSION_DIRS.map((kind) =>
			resolve(root, kind, "**", "*.jsonl"),
		);
	},
};
