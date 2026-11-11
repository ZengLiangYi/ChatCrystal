/**
 * Targeted background watcher.
 *
 * The watcher no longer runs a full `importAll` for every file event: it maps
 * each changed path to the source adapter that owns it and asks the sync
 * manager for a *targeted* pass over just those sources. Triggers that arrive
 * while a pass is running are merged by the manager, and a 1.8s debounce
 * window collects the burst of events a single write produces (a session file
 * plus its sidecars, a SQLite database plus its WAL).
 *
 * Legacy adapters keep their watch-path helpers outside the `SourceAdapter`
 * interface; those paths are bound to their source names explicitly. Every
 * other adapter contributes `adapter.watchPaths()` bound to `adapter.name`.
 *
 * WSL distro homes are never watched: `\\wsl.localhost` lookups are slow and
 * can start a stopped distro. WSL sessions are picked up by the next manual
 * import / startup sync, and every target is filtered through
 * `isWslUncPath()` as a second line of defence.
 */

import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { type FSWatcher, watch } from "chokidar";
import { appConfig } from "../config.js";
import { getCopilotWatchPaths } from "../parser/adapters/copilot.js";
import { getCursorGlobalVscdbPath } from "../parser/adapters/cursor.js";
import { getTraeWatchPaths } from "../parser/adapters/trae.js";
import { getAllAdapters } from "../parser/index.js";
import { syncManager } from "../services/sync.js";

/** File events are batched for this long before a targeted sync is requested. */
export const WATCH_DEBOUNCE_MS = 1800;

const GLOB_CHARS = /[*?[\]{}]/;

/** An existing local target and the sources that store files below it. */
export interface WatchBinding {
	/** Existing local file or directory chokidar watches (globs reduced). */
	target: string;
	/** Adapter (source) names whose conversations live below the target. */
	sources: string[];
}

interface RawWatchBinding {
	target: string;
	source: string;
}

/** True for a Windows WSL path (`\\wsl.localhost\…` or the legacy `\\wsl$\…`). */
export function isWslUncPath(path: string): boolean {
	const normalized = path.replace(/\//g, "\\");
	return /^\\\\wsl(\$|\.localhost)(\\|$)/i.test(normalized);
}

/**
 * chokidar v4+ dropped glob support, so a target such as
 * `~/.claude/projects/**\/*.jsonl` would be watched as a literal path and never
 * fire. Reduce every target to the closest existing file or directory: for a
 * glob, the static prefix before the first wildcard; chokidar watches
 * directories recursively.
 */
function normalizeWatchTarget(target: string): string | null {
	const trimmed = target.trim();
	if (!trimmed) return null;
	if (!GLOB_CHARS.test(trimmed)) {
		return existsSync(trimmed) ? trimmed : null;
	}
	const wildcardIndex = trimmed.search(GLOB_CHARS);
	const staticPrefix = trimmed.slice(0, wildcardIndex);
	const directory =
		staticPrefix.endsWith("/") || staticPrefix.endsWith("\\")
			? staticPrefix.slice(0, -1)
			: dirname(staticPrefix);
	const resolved = resolve(directory);
	return existsSync(resolved) ? resolved : null;
}

/**
 * Raw target → source pairs before glob normalization and de-duplication.
 * Legacy adapters that keep their path helpers outside the adapter interface
 * are listed first; every registered adapter then contributes `watchPaths()`.
 */
function collectRawWatchBindings(): RawWatchBinding[] {
	const bindings: RawWatchBinding[] = [];

	// Sources whose adapters keep their path helpers local (legacy adapters).
	bindings.push({
		target: `${appConfig.claudeProjectsDir}/**/*.jsonl`,
		source: "claude-code",
	});
	const cursorVscdb = getCursorGlobalVscdbPath();
	if (cursorVscdb) bindings.push({ target: cursorVscdb, source: "cursor" });
	for (const target of getTraeWatchPaths()) {
		bindings.push({ target, source: "trae" });
	}
	for (const target of getCopilotWatchPaths()) {
		bindings.push({ target, source: "copilot" });
	}

	// Every adapter that declares its own watch paths (newer sources).
	for (const adapter of getAllAdapters()) {
		if (!adapter.watchPaths) continue;
		let paths: string[];
		try {
			paths = adapter.watchPaths();
		} catch (err) {
			console.warn(
				`[Watcher] Failed to resolve watch paths for ${adapter.name}:`,
				err instanceof Error ? err.message : err,
			);
			continue;
		}
		for (const target of paths) {
			bindings.push({ target, source: adapter.name });
		}
	}

	return bindings;
}

/**
 * Existing local watch targets grouped with the sources they belong to. WSL
 * UNC targets are dropped here so chokidar never opens them.
 */
export function collectWatchBindings(): WatchBinding[] {
	const merged = new Map<string, Set<string>>();
	for (const binding of collectRawWatchBindings()) {
		const normalized = normalizeWatchTarget(binding.target);
		if (!normalized || isWslUncPath(normalized)) continue;
		let sources = merged.get(normalized);
		if (!sources) {
			sources = new Set<string>();
			merged.set(normalized, sources);
		}
		sources.add(binding.source);
	}
	return [...merged.entries()].map(([target, sources]) => ({
		target,
		sources: [...sources],
	}));
}

/** Backwards-compatible list of local watch targets (static dirs/files). */
export function collectWatchTargets(): string[] {
	return collectWatchBindings().map((binding) => binding.target);
}

function isPathInside(target: string, filePath: string): boolean {
	const rel = relative(target, filePath);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Map changed file paths to the sources that own the longest matching target.
 * Custom bindings are accepted for tests.
 */
export function mapPathsToSources(
	paths: string[],
	bindings: WatchBinding[] = collectWatchBindings(),
): string[] {
	const matched = new Set<string>();
	for (const filePath of paths) {
		if (!filePath || isWslUncPath(filePath)) continue;
		const absolutePath = resolve(filePath);
		let best: WatchBinding | null = null;
		for (const binding of bindings) {
			if (!isPathInside(binding.target, absolutePath)) continue;
			// Nested targets: the most specific one owns the file.
			if (!best || binding.target.length > best.target.length) {
				best = binding;
			}
		}
		if (!best) continue;
		for (const source of best.sources) matched.add(source);
	}
	return [...matched].sort();
}

/**
 * Start the targeted watcher. Every burst of changes becomes one
 * `syncManager.requestSources(sources)` call (merged while a pass runs).
 */
export function startWatcher(): FSWatcher {
	const bindings = collectWatchBindings();
	const watchTargets = bindings.map((binding) => binding.target);

	console.log(`[Watcher] Watching ${watchTargets.length} target(s):`);
	for (const target of watchTargets) {
		console.log(`  - ${target}`);
	}

	const watcher = watch(watchTargets, {
		ignoreInitial: true,
		// Plugin/node_modules trees are never session stores; skipping them keeps
		// the initial watch scan cheap (a workbuddy home can hold ~70k files).
		ignored: (path: string) =>
			/[\\/](node_modules|\.git|\.cache)([\\/]|$)/.test(path),
		awaitWriteFinish: {
			stabilityThreshold: 2000,
			pollInterval: 500,
		},
	});

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	const pendingPaths: string[] = [];

	const flush = (): void => {
		debounceTimer = null;
		if (pendingPaths.length === 0) return;
		const changed = pendingPaths.splice(0, pendingPaths.length);
		const sources = mapPathsToSources(changed, bindings);
		if (sources.length === 0) {
			console.warn(
				`[Watcher] ${changed.length} change(s) did not map to a source; ignoring`,
			);
			return;
		}
		console.log(
			`[Watcher] ${changed.length} change(s) in ${sources.join(", ")}; requesting targeted sync`,
		);
		syncManager.requestSources(sources);
	};

	const scheduleSync = (path: string): void => {
		if (isWslUncPath(path)) return;
		pendingPaths.push(path);
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(flush, WATCH_DEBOUNCE_MS);
		if (typeof debounceTimer.unref === "function") debounceTimer.unref();
	};

	watcher.on("add", (path) => {
		console.log(`[Watcher] New file: ${path}`);
		scheduleSync(path);
	});

	watcher.on("change", (path) => {
		console.log(`[Watcher] Changed: ${path}`);
		scheduleSync(path);
	});

	watcher.on("error", (err) => {
		console.error("[Watcher] Error:", err instanceof Error ? err.message : err);
	});

	return watcher;
}
