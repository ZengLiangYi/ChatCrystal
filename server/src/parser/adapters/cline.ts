/**
 * Cline adapter.
 *
 * Cline has two generations of on-disk history, both parsed here:
 *
 * 1. Modern CLI / SDK — one directory per session under
 *    `<clineDataDir>/data/sessions/<sessionId>/`:
 *    - `<sessionId>.messages.json` — the whole conversation. It is usually
 *      `{ messages: [...] }` but a plain array is accepted too.
 *    - `<sessionId>.json` — manifest with `session_id`, `cwd`, `started_at`
 *      and `metadata.title`.
 * 2. Legacy VS Code extension (`saoudrizwan.claude-dev`) — one directory per
 *    task under `<clineExtDataDir>/tasks/<taskId>/`, parsed by the shared
 *    Cline-lineage helper in `vscode-tasks.ts`.
 *
 * Both stores can also run inside a WSL distro: the CLI under `~/.cline` and
 * the VS Code Remote extension under
 * `~/.vscode-server/data/User/globalStorage/saoudrizwan.claude-dev`. Every
 * discovered root is scanned and each meta records the root it was found under
 * (`rootDir`) so parse can read the store's root-level metadata.
 */

import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
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
	mergeCompanionFile,
	parseVscodeTask,
	projectNameFromDir,
	readJsonFile,
	scanVscodeTasks,
	toEpochMs,
	toRecord,
	truncateSlug,
	vscodeTaskWatchPaths,
	type VscodeTaskRoot,
} from "./vscode-tasks.js";

// =============================================
// Raw CLI file shapes
// =============================================

interface ClineCliManifest {
	session_id?: string;
	cwd?: string;
	workspace_root?: string;
	started_at?: string;
	prompt?: string;
	metadata?: {
		title?: string;
	};
}

// =============================================
// Paths
// =============================================

/**
 * Distro-home-relative locations of the two Cline stores. VS Code Remote keeps
 * globalStorage under `.vscode-server/data/User` instead of the Windows
 * `%APPDATA%` / `~/.cline` paths.
 */
const CLI_WSL_RELATIVE = ".cline";
const EXT_WSL_RELATIVE =
	".vscode-server/data/User/globalStorage/saoudrizwan.claude-dev";

/** Data roots of the modern CLI store: the local `~/.cline` plus any WSL ones. */
function cliDataRoots(): string[] {
	return withWslRoots(appConfig.clineDataDir, CLI_WSL_RELATIVE);
}

/** Local `<clineDataDir>/data/sessions` folder; only the watcher uses it. */
function getLocalCliSessionsDir(): string {
	return resolve(appConfig.clineDataDir, "data", "sessions");
}

function extensionRootAt(root: string): VscodeTaskRoot {
	return {
		root,
		source: "cline",
		history: "task-history",
	};
}

/** Task-store roots of the legacy VS Code extension: local plus any WSL ones. */
function extensionRoots(): VscodeTaskRoot[] {
	return withWslRoots(appConfig.clineExtDataDir, EXT_WSL_RELATIVE).map(
		(root) => extensionRootAt(root),
	);
}

/** The Windows-local extension store; only the watcher uses it. */
function getLocalExtensionRoot(): VscodeTaskRoot {
	return extensionRootAt(appConfig.clineExtDataDir);
}

/** De-duplicate conversations when roots overlap (case-insensitively on Windows). */
function dedupeMetas(metas: ConversationMeta[]): ConversationMeta[] {
	const seen = new Set<string>();
	const deduped: ConversationMeta[] = [];
	for (const meta of metas) {
		const absolute = resolve(meta.filePath);
		const key =
			process.platform === "win32" ? absolute.toLowerCase() : absolute;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(meta);
	}
	return deduped;
}

// =============================================
// Cline CLI sanitization
// =============================================

const MODE_NOTICE_PATTERN = /<mode_notice\b[^>]*>[\s\S]*?<\/mode_notice>/g;
const USER_INPUT_ENVELOPE_PATTERN =
	/^<(?:user_input|user_command)\b[^>]*>([\s\S]*)<\/(?:user_input|user_command)>$/;

/**
 * Cline CLI wraps prompts in `<mode_notice>...</mode_notice>` and
 * `<user_input mode="...">...</user_input>` envelopes; index only the words
 * the user actually typed.
 */
function sanitizeCliUserText(text: string): string {
	const withoutNotices = text.replace(MODE_NOTICE_PATTERN, "").trim();
	const match = USER_INPUT_ENVELOPE_PATTERN.exec(withoutNotices);
	return (match?.[1] ?? withoutNotices).trim();
}

// =============================================
// Cline CLI scan / parse
// =============================================

async function readCliManifest(
	sessionDir: string,
	sessionId: string,
): Promise<ClineCliManifest | null> {
	const raw = await readJsonFile(resolve(sessionDir, `${sessionId}.json`));
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		return null;
	}
	return raw as ClineCliManifest;
}

/** Project directory from the manifest's `cwd`, falling back to `workspace_root`. */
function cliProjectDir(manifest: ClineCliManifest | null): string {
	const candidates = [manifest?.cwd, manifest?.workspace_root];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate) return decodeFileUri(candidate);
	}
	return "";
}

async function scanCliSessions(): Promise<ConversationMeta[]> {
	const metas: ConversationMeta[] = [];
	for (const dataRoot of cliDataRoots()) {
		const sessionsDir = resolve(dataRoot, "data", "sessions");
		const sessionIds = await readdir(sessionsDir).catch(() => null);
		if (!sessionIds) continue;

		for (const sessionId of sessionIds.sort()) {
			const sessionDir = resolve(sessionsDir, sessionId);
			const messagesPath = resolve(sessionDir, `${sessionId}.messages.json`);
			const messagesStat = await stat(messagesPath).catch(() => null);
			if (!messagesStat?.isFile()) continue;

			const manifest = await readCliManifest(sessionDir, sessionId);
			// Fold the manifest into the meta so a title-only rewrite still counts
			// as a change for the import service's size+mtime dedup.
			const times = { size: messagesStat.size, mtime: messagesStat.mtime };
			await mergeCompanionFile(times, resolve(sessionDir, `${sessionId}.json`));

			metas.push({
				id: sessionId,
				source: "cline",
				filePath: messagesPath,
				fileSize: times.size,
				fileMtime: times.mtime.toISOString(),
				projectDir: cliProjectDir(manifest),
				rootDir: dataRoot,
			});
		}
	}
	return metas;
}

async function parseCliSession(
	meta: ConversationMeta,
): Promise<ParsedConversation> {
	const sessionDir = dirname(meta.filePath);
	const sessionId = basename(sessionDir);
	const manifest = await readCliManifest(sessionDir, sessionId);
	const rawMessages = await readJsonFile(meta.filePath);
	const entries = asArrayField(rawMessages, ["messages"]);

	const baseMs =
		toEpochMs(manifest?.started_at) ??
		toEpochMs(meta.fileMtime) ??
		new Date().getTime();

	const messages: ParsedMessage[] = [];
	let firstUserText: string | null = null;
	// Keep timestamps non-decreasing: use the CLI's own `ts` when it moves the
	// clock forward, otherwise advance one second past the previous message.
	let previousMs = baseMs - 1000;

	for (const entry of entries) {
		const record = toRecord(entry);
		if (!record) continue; // Skip corrupt entries, keep the rest of the session.
		const role = record.role;
		if (role !== "user" && role !== "assistant") continue;

		const extraction = extractContentText(record.content);
		const content =
			role === "user" ? sanitizeCliUserText(extraction.text) : extraction.text;
		if (!content && extraction.thinking === null && !extraction.hasToolUse) {
			continue;
		}
		if (role === "user" && firstUserText === null && content) {
			firstUserText = content;
		}

		const messageTs = toEpochMs(record.ts);
		previousMs =
			messageTs !== null && messageTs > previousMs
				? messageTs
				: previousMs + 1000;

		messages.push({
			id: `${sessionId}-${messages.length}`,
			parentUuid: null,
			type: role,
			role,
			content,
			hasToolUse: extraction.hasToolUse,
			hasCode: extraction.hasCode,
			thinking: extraction.thinking,
			timestamp: new Date(previousMs).toISOString(),
		});
	}

	const title =
		typeof manifest?.metadata?.title === "string"
			? manifest.metadata.title
			: "";
	const manifestPrompt =
		typeof manifest?.prompt === "string"
			? sanitizeCliUserText(manifest.prompt)
			: "";
	const projectDir = cliProjectDir(manifest) || meta.projectDir;
	const fallbackIso = new Date(baseMs).toISOString();

	return {
		id: meta.id,
		slug: truncateSlug(title || firstUserText || manifestPrompt),
		source: "cline",
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
// Cline Adapter
// =============================================

async function scanStores(): Promise<{
	cli: ConversationMeta[];
	extension: ConversationMeta[];
}> {
	const [cli, extension] = await Promise.all([
		scanCliSessions(),
		scanExtensionTasks(),
	]);
	return { cli, extension };
}

/** Scan every legacy extension task store root; a failing root is skipped. */
async function scanExtensionTasks(): Promise<ConversationMeta[]> {
	const metas: ConversationMeta[] = [];
	for (const root of extensionRoots()) {
		try {
			metas.push(...(await scanVscodeTasks(root)));
		} catch {
			// The distro may stop between roots; keep the conversations we have.
		}
	}
	return metas;
}

export const clineAdapter: SourceAdapter = {
	name: "cline",
	displayName: "Cline",
	parserVersion: "cline@2",

	async detect(): Promise<SourceInfo | null> {
		try {
			const { cli, extension } = await scanStores();
			const conversationCount = cli.length + extension.length;
			if (conversationCount === 0) return null;
			return {
				name: "cline",
				displayName: "Cline",
				// Report the store that actually holds data: modern CLI sessions
				// first, the legacy VS Code extension as the fallback.
				dataDir:
					cli.length > 0 ? appConfig.clineDataDir : appConfig.clineExtDataDir,
				conversationCount,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		const { cli, extension } = await scanStores();
		// The two stores live in different folders, but a misconfigured setup can
		// point both roots at the same directory; never list one file twice.
		return dedupeMetas([...cli, ...extension]);
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		if (meta.filePath.endsWith(".messages.json")) {
			return parseCliSession(meta);
		}
		// The extension keeps its task metadata in the store root's
		// `state/taskHistory.json`; a WSL/VS Code Remote task must read it from
		// the root it was scanned from, falling back to the primary install.
		const extensionRoot = extensionRootAt(
			meta.rootDir ?? appConfig.clineExtDataDir,
		);
		return parseVscodeTask(meta, extensionRoot);
	},

	watchPaths(): string[] {
		const paths: string[] = [];
		const sessionsDir = getLocalCliSessionsDir();
		if (existsSync(sessionsDir)) {
			// Both `<id>.messages.json` and the `<id>.json` manifest live below.
			paths.push(resolve(sessionsDir, "**", "*"));
		}
		paths.push(...vscodeTaskWatchPaths(getLocalExtensionRoot()));
		// WSL sessions are intentionally not watched: `\\wsl.localhost` paths are
		// slow to stat and can start a stopped distro. They are imported on the
		// next manual Import instead.
		return paths;
	},
};
