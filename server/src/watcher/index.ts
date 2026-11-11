import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { watch } from "chokidar";
import { appConfig } from "../config.js";
import { getCopilotWatchPaths } from "../parser/adapters/copilot.js";
import { getCursorGlobalVscdbPath } from "../parser/adapters/cursor.js";
import { getTraeWatchPaths } from "../parser/adapters/trae.js";
import { getAllAdapters } from "../parser/index.js";
import { importAll } from "../services/import.js";

let isImporting = false;
let pendingImport = false;

async function runImport() {
	if (isImporting) {
		pendingImport = true;
		return;
	}
	isImporting = true;
	try {
		const result = await importAll();
		if (result.imported > 0 || result.replaced > 0) {
			console.log(
				`[Watcher] Auto-imported ${result.imported} new, ${result.replaced} updated conversations`,
			);
		}
	} catch (err) {
		console.error(
			"[Watcher] Import error:",
			err instanceof Error ? err.message : err,
		);
	} finally {
		isImporting = false;
		if (pendingImport) {
			pendingImport = false;
			// Delay to batch rapid changes
			setTimeout(runImport, 2000);
		}
	}
}

// Debounce: wait for file writes to settle
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedImport() {
	if (debounceTimer) clearTimeout(debounceTimer);
	debounceTimer = setTimeout(runImport, 3000);
}

const GLOB_CHARS = /[*?[\]{}]/;

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
	const directory = staticPrefix.endsWith("/") || staticPrefix.endsWith("\\")
		? staticPrefix.slice(0, -1)
		: dirname(staticPrefix);
	const resolved = resolve(directory);
	return existsSync(resolved) ? resolved : null;
}

export function collectWatchTargets(): string[] {
	const rawTargets: string[] = [];

	// Sources whose adapters keep their path helpers local (legacy adapters).
	rawTargets.push(`${appConfig.claudeProjectsDir}/**/*.jsonl`);
	const cursorVscdb = getCursorGlobalVscdbPath();
	if (cursorVscdb) rawTargets.push(cursorVscdb);
	rawTargets.push(...getTraeWatchPaths());
	rawTargets.push(...getCopilotWatchPaths());

	// Every adapter that declares its own watch paths (newer sources).
	for (const adapter of getAllAdapters()) {
		if (!adapter.watchPaths) continue;
		try {
			rawTargets.push(...adapter.watchPaths());
		} catch (err) {
			console.warn(
				`[Watcher] Failed to resolve watch paths for ${adapter.name}:`,
				err instanceof Error ? err.message : err,
			);
		}
	}

	const targets: string[] = [];
	for (const target of rawTargets) {
		const normalized = normalizeWatchTarget(target);
		if (normalized && !targets.includes(normalized)) {
			targets.push(normalized);
		}
	}
	return targets;
}

export function startWatcher() {
	const watchTargets = collectWatchTargets();

	console.log(`[Watcher] Watching ${watchTargets.length} target(s):`);
	for (const t of watchTargets) {
		console.log(`  - ${t}`);
	}

	const watcher = watch(watchTargets, {
		ignoreInitial: true,
		awaitWriteFinish: {
			stabilityThreshold: 2000,
			pollInterval: 500,
		},
	});

	watcher.on("add", (path) => {
		console.log(`[Watcher] New file: ${path}`);
		debouncedImport();
	});

	watcher.on("change", (path) => {
		console.log(`[Watcher] Changed: ${path}`);
		debouncedImport();
	});

	watcher.on("error", (err) => {
		console.error("[Watcher] Error:", err instanceof Error ? err.message : err);
	});

	return watcher;
}
