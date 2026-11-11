/**
 * CodeBuddy Code adapter.
 *
 * Tencent's CodeBuddy Code CLI keeps its sessions the way WorkBuddy does, in
 * its own data folder:
 *
 *   <dataDir>/projects/<mangled-cwd>/<sessionId>.jsonl
 *
 * The lines are the same OpenAI Agents SDK items WorkBuddy writes
 * (`session-meta`, `message`, `reasoning`, `function_call`,
 * `function_call_result`, `ai-title` / `custom-title`, …), so parsing is
 * delegated to the WorkBuddy adapter and only the source id is overridden.
 * Subagent transcripts live below `<sessionId>/subagents/` and are skipped.
 *
 * The CLI can also run inside a WSL distro (same relative folder under the
 * distro user's home); those roots are scanned too and every meta records the
 * root it came from.
 */

import { existsSync, type Dirent } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type {
	ConversationMeta,
	ParsedConversation,
	SourceInfo,
} from "@chatcrystal/shared";
import { appConfig } from "../../config.js";
import type { SourceAdapter } from "../adapter.js";
import { withWslRoots } from "../sourceRoots.js";
import { workbuddyAdapter } from "./workbuddy.js";

const SOURCE_NAME = "codebuddy";
const DISPLAY_NAME = "CodeBuddy";
const PARSER_VERSION = "codebuddy@1";
const WSL_RELATIVE_PATH = ".codebuddy";

/** Files smaller than this cannot hold a JSON record and are skipped. */
const MIN_TRANSCRIPT_BYTES = 2;

/** How much of a session file's head is read to recover its sessionId. */
const HEAD_BYTES = 16 * 1024;

interface CodeBuddySessionFile {
	id: string;
	filePath: string;
	fileSize: number;
	fileMtime: string;
	/** Encoded project folder name (the cwd is recorded per item in parse). */
	projectDir: string;
	rootDir: string;
}

/** Read enough of a session file's head to find its `sessionId`. */
async function readSessionIdFromHead(
	filePath: string,
): Promise<string | null> {
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		handle = await open(filePath, "r");
		const buffer = Buffer.alloc(HEAD_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const head = buffer.subarray(0, bytesRead).toString("utf8");
		const match = /"sessionId"\s*:\s*"([^"]+)"/.exec(head);
		const sessionId = match?.[1]?.trim();
		return sessionId || null;
	} catch {
		return null;
	} finally {
		await handle?.close().catch(() => {
			// best-effort close; nothing useful to do here
		});
	}
}

/** Windows-local root plus every WSL home holding the same relative folder. */
function dataRoots(): string[] {
	return withWslRoots(resolve(appConfig.codebuddyDataDir), WSL_RELATIVE_PATH);
}

/**
 * Collect the session files of every data root. Only files directly below a
 * project folder are conversations (`<sessionId>/subagents/*.jsonl` are not),
 * and only their directory entries are read — message content is parsed lazily
 * by `parse()`.
 */
async function collectSessionFiles(): Promise<CodeBuddySessionFile[]> {
	const sessions: CodeBuddySessionFile[] = [];

	for (const root of dataRoots()) {
		const projectsDir = resolve(root, "projects");
		if (!existsSync(projectsDir)) continue;

		let projectEntries: Dirent[];
		try {
			projectEntries = await readdir(projectsDir, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const projectEntry of projectEntries) {
			if (!projectEntry.isDirectory() || projectEntry.name.startsWith(".")) {
				continue;
			}
			const projectPath = resolve(projectsDir, projectEntry.name);

			let files: Dirent[];
			try {
				files = await readdir(projectPath, { withFileTypes: true });
			} catch {
				continue;
			}

			for (const file of files) {
				// Subagent transcripts are nested one level deeper.
				if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
				if (file.name.startsWith(".")) continue;

				const filePath = resolve(projectPath, file.name);
				let fileStat: Awaited<ReturnType<typeof stat>>;
				try {
					fileStat = await stat(filePath);
				} catch {
					continue;
				}
				if (fileStat.size < MIN_TRANSCRIPT_BYTES) continue;

				const fileBaseName = basename(file.name, ".jsonl");
				const sessionId = await readSessionIdFromHead(filePath);

				sessions.push({
					// The sessionId inside the file is the stable identity (normally
					// it is also the file name).
					id: sessionId || fileBaseName,
					filePath,
					fileSize: fileStat.size,
					fileMtime: fileStat.mtime.toISOString(),
					projectDir: projectEntry.name,
					rootDir: root,
				});
			}
		}
	}

	return sessions;
}

export const codebuddyAdapter: SourceAdapter = {
	name: SOURCE_NAME,
	displayName: DISPLAY_NAME,
	parserVersion: PARSER_VERSION,

	async detect(): Promise<SourceInfo | null> {
		try {
			const sessions = await collectSessionFiles();
			if (sessions.length === 0) return null;
			return {
				name: SOURCE_NAME,
				displayName: DISPLAY_NAME,
				dataDir: resolve(appConfig.codebuddyDataDir),
				conversationCount: sessions.length,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		let sessions: CodeBuddySessionFile[];
		try {
			sessions = await collectSessionFiles();
		} catch {
			return [];
		}

		return sessions.map((session) => ({
			id: session.id,
			source: SOURCE_NAME,
			filePath: session.filePath,
			fileSize: session.fileSize,
			fileMtime: session.fileMtime,
			// The project is the mangled folder name; parse() prefers the cwd
			// recorded on the session's first item.
			projectDir: session.projectDir,
			rootDir: session.rootDir,
		}));
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		// CodeBuddy uses WorkBuddy's item format; only the source id and the
		// conversation id (always the scanned id) differ.
		const parsed = await workbuddyAdapter.parse(meta);
		return { ...parsed, id: meta.id, source: SOURCE_NAME };
	},

	watchPaths(): string[] {
		// Only the local folder is watched: chokidar cannot watch UNC paths and
		// touching a stopped WSL distro would start it. WSL sessions are picked
		// up by the next manual Import.
		const root = resolve(appConfig.codebuddyDataDir);
		if (!existsSync(root)) return [];
		return [resolve(root, "projects", "**", "*.jsonl")];
	},
};
