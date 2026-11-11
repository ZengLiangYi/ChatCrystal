/**
 * Roo Code adapter.
 *
 * Roo Code is a Cline fork and keeps the same task layout under its VS Code
 * globalStorage directory:
 *
 * `<rooDataDir>/tasks/<taskId>/api_conversation_history.json`
 * `<rooDataDir>/tasks/<taskId>/history_item.json`
 *
 * The transcript is Anthropic-shaped (`{ role, content }` turns with content
 * blocks), the first user prompt may be wrapped in `<task>...</task>`, and
 * tool calls arrive as `tool_use` blocks. All of that is handled by the shared
 * Cline-lineage helper in `vscode-tasks.ts`.
 *
 * The store can also live inside a WSL distro (VS Code Remote keeps it under
 * `.vscode-server/data/User/globalStorage`), so every configured root is
 * scanned along with its WSL counterparts.
 */

import type {
	ConversationMeta,
	ParsedConversation,
	SourceInfo,
} from "@chatcrystal/shared";
import { appConfig } from "../../config.js";
import type { SourceAdapter } from "../adapter.js";
import { withWslRoots } from "../sourceRoots.js";
import {
	parseVscodeTask,
	scanVscodeTasks,
	vscodeTaskWatchPaths,
	type VscodeTaskRoot,
} from "./vscode-tasks.js";

const ROOT: VscodeTaskRoot = {
	root: appConfig.rooDataDir,
	source: "roo",
	history: "per-task",
};

/** VS Code Remote path of the extension's globalStorage folder, under WSL home. */
const WSL_RELATIVE =
	".vscode-server/data/User/globalStorage/rooveterinaryinc.roo-cline";

/** The local Windows install plus every WSL distro home that has the store. */
function taskRoots(): VscodeTaskRoot[] {
	return withWslRoots(appConfig.rooDataDir, WSL_RELATIVE).map((root) => ({
		...ROOT,
		root,
	}));
}

/** Scan every root; a root that becomes unreadable is skipped, not fatal. */
async function scanAllRoots(): Promise<ConversationMeta[]> {
	const metas: ConversationMeta[] = [];
	for (const root of taskRoots()) {
		try {
			metas.push(...(await scanVscodeTasks(root)));
		} catch {
			// A WSL distro may stop between roots; keep what we scanned.
		}
	}
	return metas;
}

export const rooAdapter: SourceAdapter = {
	name: "roo",
	displayName: "Roo Code",
	parserVersion: "roo@2",

	async detect(): Promise<SourceInfo | null> {
		try {
			const conversations = await scanAllRoots();
			if (conversations.length === 0) return null;
			return {
				name: "roo",
				displayName: "Roo Code",
				dataDir: ROOT.root,
				conversationCount: conversations.length,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		return scanAllRoots();
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		// History metadata is per-task here, but the helper still prefers
		// `meta.rootDir` for any root-level metadata it may need.
		return parseVscodeTask(meta, ROOT);
	},

	watchPaths(): string[] {
		// Only the local Windows store: `\\wsl.localhost` paths are slow and may
		// start a stopped distro. WSL conversations sync on the next manual Import.
		return vscodeTaskWatchPaths(ROOT);
	},
};
