/**
 * omp (oh-my-pi, a Pi fork) adapter.
 *
 * omp keeps Pi's session layout — one `<time>_<session id>.jsonl` file per
 * session, in a folder per cwd — under its agent folder
 * (`$OMP_DATA_DIR`, else `~/.omp/agent`):
 *
 *   <ompDataDir>/sessions/<encoded cwd>/<time>_<session id>.jsonl
 *   <ompDataDir>/../profiles/<name>/agent/sessions/<encoded cwd>/<time>_<id>.jsonl
 *
 * A named profile (`omp --profile <name>`) relocates the whole user scope, so
 * every profile beside the agent folder is read too. The transcript format is
 * Pi's (`pi-sessions.ts`) with the additions read here: a fixed-width `title`
 * line before the header, `title_change` entries, and `model_usage` entries.
 *
 * The same layout lives inside a WSL distro home (`~/.omp/agent`), so every
 * root returned by `withWslRoots` is scanned.
 */

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
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

const SOURCE_NAME = "omp";
const DISPLAY_NAME = "oh-my-pi";
const WSL_RELATIVE_DIR = ".omp/agent";

/** Local omp agent folder plus every WSL distro home that has `.omp/agent`. */
function ompRoots(): string[] {
	return withWslRoots(appConfig.ompDataDir, WSL_RELATIVE_DIR);
}

/**
 * Sessions folders of one omp agent folder: its own `sessions/`, and each
 * named profile's `~/.omp/profiles/<name>/agent/sessions` beside it.
 */
async function ompSessionLocations(): Promise<PiSessionLocation[]> {
	const locations: PiSessionLocation[] = [];

	for (const root of ompRoots()) {
		locations.push({
			dir: join(root, "sessions"),
			layout: "project",
			rootDir: root,
		});

		const profilesDir = join(dirname(root), "profiles");
		let profiles: Dirent[];
		try {
			profiles = await readdir(profilesDir, { withFileTypes: true });
		} catch {
			// No profiles, or a stopped WSL distro: the default store stands.
			continue;
		}
		for (const profile of profiles) {
			if (!profile.isDirectory() || profile.name.startsWith(".")) continue;
			locations.push({
				dir: join(profilesDir, profile.name, "agent", "sessions"),
				layout: "project",
				rootDir: root,
			});
		}
	}

	return locations;
}

export const ompAdapter: SourceAdapter = {
	name: SOURCE_NAME,
	displayName: DISPLAY_NAME,
	parserVersion: "omp@1",

	async detect(): Promise<SourceInfo | null> {
		try {
			const conversationCount = (
				await collectPiSessions(await ompSessionLocations())
			).length;
			if (conversationCount === 0) return null;

			return {
				name: SOURCE_NAME,
				displayName: DISPLAY_NAME,
				dataDir: appConfig.ompDataDir,
				conversationCount,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		const sessions = await collectPiSessions(await ompSessionLocations());
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
		// Watch the local installs only: watching `\\wsl.localhost` UNC paths is
		// slow and would start stopped distros. WSL sessions are picked up on the
		// next manual Import.
		return [
			join(appConfig.ompDataDir, "sessions", "**", "*.jsonl"),
			join(
				dirname(appConfig.ompDataDir),
				"profiles",
				"*",
				"agent",
				"sessions",
				"**",
				"*.jsonl",
			),
		];
	},
};
