/**
 * Qoder / Qoder CN adapters.
 *
 * Qoder's CLI (qodercli, and qoderclicn for the China site) keeps its sessions
 * exactly as Claude Code does, in its data folder:
 *
 *   <dataDir>/projects/<mangled-cwd>/<id>.jsonl
 *
 * The lines are Claude Code's own (`user` / `assistant` records with `uuid`,
 * `parentUuid`, `cwd`, `timestamp`, `message`), plus the `ai-title` /
 * `custom-title` / `summary` records Claude Code also writes. Subagent
 * transcripts live one level deeper (`<id>/subagents/*.jsonl`) and are not main
 * conversations.
 *
 * The parsing is therefore delegated to the Claude Code adapter: scan only
 * stats files and builds `ConversationMeta`s, parse returns what Claude Code's
 * parser extracted with the `source` changed to this build's id. The only
 * extra work is the title: the Claude Code parser does not read `ai-title`
 * records, so a short tail scan recovers the session name when the transcript
 * carries no `slug` field.
 *
 * Both builds can also run inside a WSL distro (same relative folders under the
 * distro user's home); those roots are scanned too and every meta records the
 * root it came from.
 */

import { existsSync, type Dirent, type Stats } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type {
	ConversationMeta,
	ParsedConversation,
	SourceInfo,
} from "@chatcrystal/shared";
import { appConfig } from "../../config.js";
import type { SourceAdapter } from "../adapter.js";
import { withWslRoots } from "../sourceRoots.js";
import { claudeCodeAdapter } from "./claude-code.js";

/** How much of a transcript's tail is inspected for a title record. */
const TITLE_TAIL_BYTES = 512 * 1024;

/** Files smaller than this cannot hold a JSON line and are skipped. */
const MIN_TRANSCRIPT_BYTES = 2;

export interface QoderAdapterOptions {
	/** Source id, e.g. `qoder` / `qoder-cn`. */
	name: string;
	displayName: string;
	parserVersion: string;
	/** The configured Windows-local data folder (read lazily, per call). */
	localRoot: () => string;
	/** Distro-home-relative folder of the same store, for WSL distros. */
	wslRelativePath: string;
}

interface ClaudeStyleTitleRecord {
	type?: string;
	aiTitle?: string;
	customTitle?: string;
}

/**
 * Read the newest `ai-title` / `custom-title` record from the tail of a
 * Claude Code style transcript. Titles are appended as the session is named,
 * so only the tail is read; a user-set `custom-title` wins over the generated
 * `ai-title`.
 */
export async function readClaudeStyleTitle(
	filePath: string,
): Promise<string | null> {
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
			// Cheap pre-filter: both record kinds carry a "…Title" field.
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

/** Session files directly below one root's `projects/` folder. */
async function collectRootSessionFiles(
	root: string,
	sourceName: string,
): Promise<ConversationMeta[]> {
	const projectsDir = resolve(root, "projects");
	if (!existsSync(projectsDir)) return [];

	let projectEntries: Dirent[];
	try {
		projectEntries = await readdir(projectsDir, { withFileTypes: true });
	} catch {
		return [];
	}

	const metas: ConversationMeta[] = [];
	for (const projectEntry of projectEntries) {
		if (!projectEntry.isDirectory()) continue;
		if (projectEntry.name.startsWith(".")) continue;

		const mangledDir = projectEntry.name;
		const projectPath = resolve(projectsDir, mangledDir);

		let entries: Dirent[];
		try {
			entries = await readdir(projectPath, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			// Subagent transcripts live below `<id>/subagents/`, not here.
			if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

			const filePath = resolve(projectPath, entry.name);
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
				source: sourceName,
				filePath,
				fileSize: fileStat.size,
				fileMtime: fileStat.mtime.toISOString(),
				projectDir: mangledDir,
				rootDir: root,
			});
		}
	}

	return metas;
}

/**
 * Build an adapter for one Qoder build. Both builds share this implementation;
 * only the id, display name and data folder differ.
 */
export function createQoderAdapter(
	options: QoderAdapterOptions,
): SourceAdapter {
	const localRoot = (): string => resolve(options.localRoot());

	/** Windows-local root plus every WSL home holding the same relative folder. */
	const dataRoots = (): string[] =>
		withWslRoots(localRoot(), options.wslRelativePath);

	async function collectSessionFiles(): Promise<ConversationMeta[]> {
		const metas: ConversationMeta[] = [];
		for (const root of dataRoots()) {
			try {
				metas.push(...(await collectRootSessionFiles(root, options.name)));
			} catch {
				// A WSL distro can stop mid-walk; keep the other roots' sessions.
			}
		}
		return metas;
	}

	return {
		name: options.name,
		displayName: options.displayName,
		parserVersion: options.parserVersion,

		async detect(): Promise<SourceInfo | null> {
			try {
				const metas = await collectSessionFiles();
				if (metas.length === 0) return null;
				return {
					name: options.name,
					displayName: options.displayName,
					dataDir: localRoot(),
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
			// Claude Code's parser reads the same transcript format; only the
			// source id and the title fallback are ours.
			const parsed = await claudeCodeAdapter.parse(meta);
			const slug = parsed.slug ?? (await readClaudeStyleTitle(meta.filePath));
			return { ...parsed, id: meta.id, slug, source: options.name };
		},

		watchPaths(): string[] {
			// Only the local folder is watched: chokidar cannot watch UNC paths and
			// touching a stopped WSL distro would start it. WSL sessions are picked
			// up by the next manual Import.
			const root = localRoot();
			if (!existsSync(root)) return [];
			return [resolve(root, "projects", "**", "*.jsonl")];
		},
	};
}

export const qoderAdapter: SourceAdapter = createQoderAdapter({
	name: "qoder",
	displayName: "Qoder",
	parserVersion: "qoder@1",
	localRoot: () => appConfig.qoderDataDir,
	wslRelativePath: ".qoder",
});
