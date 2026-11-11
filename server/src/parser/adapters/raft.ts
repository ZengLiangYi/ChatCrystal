/**
 * Raft (the slock app) adapter.
 *
 * Raft runs its agents each in a workspace of its own, `<slock>/agents/<agent
 * id>/`, and keeps their Pi sessions beside it:
 *
 *   <raftDataDir>/agents/<agent id>/.pi-sessions/<time>_<session id>.jsonl
 *   <raftDataDir>/agents/<agent id>/.builtin-sessions/<time>_<session id>.jsonl
 *
 * `.pi-sessions` holds the sessions of agents Raft runs on the user's Pi
 * (`~/.pi/agent`), and `.builtin-sessions` those of its own built-in runtime;
 * both are Pi-format files, all flat in the one folder (`pi-sessions.ts`).
 * Handoff notes in `<raftDataDir>/runtime-sessions` are not sessions.
 *
 * `raftDataDir` is `$SLOCK_HOME`, else `~/.slock`. The same layout lives inside
 * a WSL distro home (`~/.slock`), so every root returned by `withWslRoots` is
 * scanned.
 */

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
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

const SOURCE_NAME = "raft";
const DISPLAY_NAME = "Raft";
const WSL_RELATIVE_DIR = ".slock";
/** Session folders of each Raft agent workspace. */
const RAFT_SESSION_FOLDERS = [".pi-sessions", ".builtin-sessions"] as const;

/** Local Raft folder plus every WSL distro home that has `.slock`. */
function raftRoots(): string[] {
	return withWslRoots(appConfig.raftDataDir, WSL_RELATIVE_DIR);
}

async function raftSessionLocations(): Promise<PiSessionLocation[]> {
	const locations: PiSessionLocation[] = [];

	for (const root of raftRoots()) {
		const agentsDir = join(root, "agents");
		let agents: Dirent[];
		try {
			agents = await readdir(agentsDir, { withFileTypes: true });
		} catch {
			// Raft not installed here, or a stopped WSL distro.
			continue;
		}

		for (const agent of agents) {
			if (!agent.isDirectory() || agent.name.startsWith(".")) continue;
			for (const folder of RAFT_SESSION_FOLDERS) {
				locations.push({
					dir: join(agentsDir, agent.name, folder),
					layout: "flat",
					rootDir: root,
				});
			}
		}
	}

	return locations;
}

export const raftAdapter: SourceAdapter = {
	name: SOURCE_NAME,
	displayName: DISPLAY_NAME,
	parserVersion: "raft@1",

	async detect(): Promise<SourceInfo | null> {
		try {
			const conversationCount = (
				await collectPiSessions(await raftSessionLocations())
			).length;
			if (conversationCount === 0) return null;

			return {
				name: SOURCE_NAME,
				displayName: DISPLAY_NAME,
				dataDir: appConfig.raftDataDir,
				conversationCount,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		const sessions = await collectPiSessions(await raftSessionLocations());
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
		// Watch the local install only: watching `\\wsl.localhost` UNC paths is
		// slow and would start stopped distros. WSL sessions are picked up on the
		// next manual Import.
		return RAFT_SESSION_FOLDERS.map((folder) =>
			join(appConfig.raftDataDir, "agents", "*", folder, "*.jsonl"),
		);
	},
};
