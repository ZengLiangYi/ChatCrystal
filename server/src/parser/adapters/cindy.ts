/**
 * Cindy adapter.
 *
 * Cindy (a desktop app that runs Claude Code, Codex and Pi) starts Pi with
 * `--session-dir <its data>/pi-agent-home/sessions`, so the Pi-format sessions
 * live flat in two data folders under the user's platform config folder:
 *
 *   <cindyDataDir>/Cindy/pi-agent-home/sessions/<time>_<session id>.jsonl
 *   <cindyDataDir>/CindyGlobal/pi-agent-home/sessions/<time>_<session id>.jsonl
 *
 * `CindyGlobal` is Cindy's global build. `cindyDataDir` is the platform config
 * folder (`%APPDATA%` on Windows, `~/Library/Application Support` on macOS,
 * `$XDG_CONFIG_HOME` or `~/.config` elsewhere); `$CINDY_CONFIG_DIR` overrides
 * it. The file format is described in `pi-sessions.ts`.
 *
 * The same folders live under a WSL distro's `.config`, so every root returned
 * by `withWslRoots` is scanned.
 */

import { join } from "node:path";
import type {
	ConversationMeta,
	ParsedConversation,
	SourceInfo,
} from "@chatcrystal/shared";
import { appConfig } from "../../config.js";
import type { SourceAdapter } from "../adapter.js";
import { withWslRoots } from "../sourceRoots.js";
import {
	collectPiSessions,
	parsePiSessionFile,
	toParsedConversation,
	type PiSessionLocation,
} from "./pi-sessions.js";

const SOURCE_NAME = "cindy";
const DISPLAY_NAME = "Cindy";
/** WSL keeps the platform config folder at `~/.config`. */
const WSL_RELATIVE_DIR = ".config";
/** Cindy's stable and global builds. */
const CINDY_DATA_FOLDERS = ["Cindy", "CindyGlobal"] as const;

/** Local config folder plus every WSL distro home's `.config`. */
function cindyRoots(): string[] {
	return withWslRoots(appConfig.cindyDataDir, WSL_RELATIVE_DIR);
}

function cindySessionLocations(): PiSessionLocation[] {
	const locations: PiSessionLocation[] = [];
	for (const root of cindyRoots()) {
		for (const folder of CINDY_DATA_FOLDERS) {
			locations.push({
				dir: join(root, folder, "pi-agent-home", "sessions"),
				layout: "flat",
				rootDir: root,
			});
		}
	}
	return locations;
}

export const cindyAdapter: SourceAdapter = {
	name: SOURCE_NAME,
	displayName: DISPLAY_NAME,
	parserVersion: "cindy@1",

	async detect(): Promise<SourceInfo | null> {
		try {
			const conversationCount = (
				await collectPiSessions(cindySessionLocations())
			).length;
			if (conversationCount === 0) return null;

			return {
				name: SOURCE_NAME,
				displayName: DISPLAY_NAME,
				dataDir: appConfig.cindyDataDir,
				conversationCount,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		const sessions = await collectPiSessions(cindySessionLocations());
		return sessions.map((session) => ({
			id: session.id,
			source: SOURCE_NAME,
			filePath: session.filePath,
			fileSize: session.fileSize,
			fileMtime: session.fileMtime,
			projectDir: session.projectDir,
			rootDir: session.rootDir,
		}));
	},

	async parse(meta: ConversationMeta): Promise<ParsedConversation> {
		const parsed = await parsePiSessionFile(meta.filePath, meta.fileMtime);
		return toParsedConversation(SOURCE_NAME, meta, parsed, DISPLAY_NAME);
	},

	watchPaths(): string[] {
		// Watch the local data folders only: watching `\\wsl.localhost` UNC paths
		// is slow and would start stopped distros. WSL sessions are picked up on
		// the next manual Import.
		return CINDY_DATA_FOLDERS.map((folder) =>
			join(
				appConfig.cindyDataDir,
				folder,
				"pi-agent-home",
				"sessions",
				"*.jsonl",
			),
		);
	},
};
