/**
 * Kilo Code adapter.
 *
 * Kilo Code is a Roo Code fork, so its VS Code extension keeps the same task
 * layout:
 *
 * `<kiloDataDir>/tasks/<taskId>/api_conversation_history.json`
 * `<kiloDataDir>/tasks/<taskId>/history_item.json`
 *
 * Parsing is fully shared with Cline/Roo via `vscode-tasks.ts`.
 *
 * The store can also live inside a WSL distro (VS Code Remote keeps it under
 * `.vscode-server/data/User/globalStorage`), so every configured root is
 * scanned along with its WSL counterparts.
 *
 * TODO: the Kilo CLI store (`~/.local/share/kilo/kilo.db`, an OpenCode-schema
 * SQLite database) is not covered yet — the extension's task files are parsed
 * here, and the CLI store would need the same SQLite reading as the OpenCode
 * adapter once the migration path is worth importing.
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
	root: appConfig.kiloDataDir,
	source: "kilo",
	history: "per-task",
};

/** VS Code Remote path of the extension's globalStorage folder, under WSL home. */
const WSL_RELATIVE =
	".vscode-server/data/User/globalStorage/kilocode.kilo-code";

/** The local Windows install plus every WSL distro home that has the store. */
function taskRoots(): VscodeTaskRoot[] {
	return withWslRoots(appConfig.kiloDataDir, WSL_RELATIVE).map((root) => ({
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

export const kiloAdapter: SourceAdapter = {
	name: "kilo",
	displayName: "Kilo Code",
	parserVersion: "kilo@2",

	async detect(): Promise<SourceInfo | null> {
		try {
			const conversations = await scanAllRoots();
			if (conversations.length === 0) return null;
			return {
				name: "kilo",
				displayName: "Kilo Code",
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
