/**
 * Pi coding-agent adapter.
 *
 * Pi keeps one JSONL file per session under its agent folder:
 *
 *   <piDataDir>/sessions/<encoded cwd>/<time>_<session id>.jsonl
 *
 * `piDataDir` is `$PI_CODING_AGENT_DIR`, else `~/.pi/agent`. When the user
 * points Pi at a single session folder (`--session-dir`,
 * `$PI_CODING_AGENT_SESSION_DIR` or the `sessionDir` key of the agent folder's
 * `settings.json`) sessions lie flat in that folder instead. Both layouts are
 * read. The file format is described in `pi-sessions.ts`.
 *
 * The same layout lives inside a WSL distro home (`~/.pi/agent`), so every
 * root returned by `withWslRoots` is scanned.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
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

const SOURCE_NAME = "pi";
const DISPLAY_NAME = "Pi";
const WSL_RELATIVE_DIR = ".pi/agent";

/** Local Pi agent folder plus every WSL distro home that has `.pi/agent`. */
function piRoots(): string[] {
	return withWslRoots(appConfig.piDataDir, WSL_RELATIVE_DIR);
}

/** `~` expansion for a path from settings.json (config.ts does the env ones). */
function expandHome(value: string): string {
	if (value === "~") return homedir();
	if (value.startsWith("~/") || value.startsWith("~\\")) {
		return resolve(homedir(), value.slice(2));
	}
	return value;
}

/**
 * The single folder the user told Pi to keep its sessions in, from
 * `$PI_CODING_AGENT_SESSION_DIR` or the local agent folder's `settings.json`;
 * null when Pi uses the default per-cwd folders.
 *
 * Only the local agent folder's settings are read: inside a WSL distro the
 * setting holds a POSIX path that a Windows-side reader cannot resolve.
 */
function configuredSessionDir(): string | null {
	const fromEnv = process.env.PI_CODING_AGENT_SESSION_DIR?.trim();
	if (fromEnv) return resolveSessionDir(fromEnv);

	try {
		const raw = readFileSync(
			join(appConfig.piDataDir, "settings.json"),
			"utf-8",
		);
		const settings = JSON.parse(raw) as { sessionDir?: unknown };
		if (
			typeof settings.sessionDir === "string" &&
			settings.sessionDir.trim()
		) {
			return resolveSessionDir(settings.sessionDir);
		}
	} catch {
		// No settings.json (or not valid JSON): Pi keeps the default layout.
	}
	return null;
}

function resolveSessionDir(value: string): string {
	const expanded = expandHome(value.trim());
	return isAbsolute(expanded)
		? expanded
		: resolve(appConfig.piDataDir, expanded);
}

function piSessionLocations(): PiSessionLocation[] {
	const locations: PiSessionLocation[] = piRoots().map(
		(root): PiSessionLocation => ({
			dir: join(root, "sessions"),
			layout: "project",
			rootDir: root,
		}),
	);

	const customDir = configuredSessionDir();
	if (customDir) {
		locations.push({ dir: customDir, layout: "flat", rootDir: customDir });
	}
	return locations;
}

export const piAdapter: SourceAdapter = {
	name: SOURCE_NAME,
	displayName: DISPLAY_NAME,
	parserVersion: "pi@1",

	async detect(): Promise<SourceInfo | null> {
		try {
			const conversationCount = (
				await collectPiSessions(piSessionLocations())
			).length;
			if (conversationCount === 0) return null;

			return {
				name: SOURCE_NAME,
				displayName: DISPLAY_NAME,
				dataDir: appConfig.piDataDir,
				conversationCount,
			};
		} catch {
			return null;
		}
	},

	async scan(): Promise<ConversationMeta[]> {
		const sessions = await collectPiSessions(piSessionLocations());
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
		const targets = [join(appConfig.piDataDir, "sessions", "**", "*.jsonl")];
		const customDir = configuredSessionDir();
		if (customDir) targets.push(join(customDir, "*.jsonl"));
		return targets;
	},
};
