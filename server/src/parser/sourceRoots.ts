/**
 * Extra data roots for sources that can also live inside a WSL distro.
 *
 * A source's Windows install keeps its data under its own app-data folder; the
 * same agent installed in a WSL distro keeps the same relative layout under the
 * distro user's home (`~/.codex/sessions`, `~/.claude/projects`, ...), readable
 * from Windows through `\\wsl.localhost\<distro>\home\<user>`.
 *
 * Adapters that support WSL call `withWslRoots(primaryDir, '<relative>')` and
 * scan every returned root. Only existing roots are returned for WSL, so a host
 * without WSL (or with the agent absent) pays nothing.
 *
 * `meta.rootDir` is set by adapters for WSL-backed sessions when a later parse
 * needs the root again (Gemini `projects.json`, Antigravity summary DB, ...).
 */

import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { getWslHomes } from "./wsl.js";

/** Deduplicate case-insensitively on Windows; keep the first spelling. */
function dedupe(paths: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const path of paths) {
		const key =
			process.platform === "win32" ? normalize(path).toLowerCase() : normalize(path);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(path);
	}
	return result;
}

/**
 * Existing WSL paths for a distro-home-relative folder, for every detected
 * distro home. Returns an empty array outside WSL-capable environments.
 */
export function wslRootsFor(relativePath: string): string[] {
	const relative = relativePath.replace(/^[\\/]+/, "");
	const roots: string[] = [];
	for (const home of getWslHomes()) {
		const candidate = join(home.home, relative);
		try {
			if (existsSync(candidate)) roots.push(candidate);
		} catch {
			// A stopped distro can make UNC stats throw; skip that home.
		}
	}
	return dedupe(roots);
}

/**
 * The source root plus every WSL root holding the same relative folder.
 * The primary root is always included so `detect()` keeps its existing
 * "does the local install exist" semantics.
 */
export function withWslRoots(
	primaryDir: string,
	relativePath: string,
): string[] {
	return dedupe([primaryDir, ...wslRootsFor(relativePath)]);
}
