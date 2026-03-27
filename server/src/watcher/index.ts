import { watch } from 'chokidar';
import { appConfig } from '../config.js';
import { importAll } from '../services/import.js';

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
    console.error('[Watcher] Import error:', err instanceof Error ? err.message : err);
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
  const dir = appConfig.claudeProjectsDir;
  console.log(`[Watcher] Watching ${dir}`);

  const watcher = watch(`${dir}/**/*.jsonl`, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 500,
    },
  });

  watcher.on('add', (path) => {
    console.log(`[Watcher] New file: ${path}`);
    debouncedImport();
  });

  watcher.on('change', (path) => {
    console.log(`[Watcher] Changed: ${path}`);
    debouncedImport();
  });

  watcher.on('error', (err) => {
    console.error('[Watcher] Error:', err instanceof Error ? err.message : err);
  });

  return watcher;
}
