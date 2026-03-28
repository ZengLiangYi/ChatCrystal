import { existsSync } from "node:fs";
import { watch } from "chokidar";
import { appConfig } from "../config.js";
import { getCursorGlobalVscdbPath } from "../parser/adapters/cursor.js";
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
		if (result.imported > 0) {
			console.log(`[Watcher] Auto-imported ${result.imported} conversations`);
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

export function startWatcher() {
	const watchTargets: string[] = [];

	// Claude Code
	const claudeDir = appConfig.claudeProjectsDir;
	watchTargets.push(`${claudeDir}/**/*.jsonl`);

	// Codex CLI
	const codexDir = appConfig.codexSessionsDir;
	if (existsSync(codexDir)) {
		watchTargets.push(`${codexDir}/**/*.jsonl`);
	}

	// Cursor (watch the global vscdb file)
	const cursorVscdb = getCursorGlobalVscdbPath();
	if (cursorVscdb) {
		watchTargets.push(cursorVscdb);
	}

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
