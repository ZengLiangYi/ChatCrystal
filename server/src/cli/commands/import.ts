import type { Command } from 'commander';
import { CrystalClient } from '../client.js';
import {
  shouldOutputJson, outputJson,
  printSuccess, printError, printKeyValue,
} from '../formatter.js';

const BAR_WIDTH = 30;

function renderProgress(current: number, total: number, imported: number, skipped: number, errors: number): void {
  if (total === 0) return;

  const ratio = current / total;
  const filled = Math.round(BAR_WIDTH * ratio);
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
  const pct = Math.round(ratio * 100);

  const line = `  ${bar} ${pct}% (${current}/${total}) imported:${imported} skipped:${skipped} errors:${errors}`;

  // Overwrite current line
  process.stderr.write(`\r${line}`);
}

export function registerImportCommand(program: Command) {
  program
    .command('import')
    .description('Scan and import conversations from all sources')
    .option('-s, --source <source>', 'Import from specific source (claude-code, codex, cursor)')
    .action(async (opts) => {
      const globalOpts = program.opts();
      const client = new CrystalClient(globalOpts.baseUrl);
      const isTTY = process.stdout.isTTY ?? false;

      try {
        let data: { total: number; imported: number; skipped: number; errors: number };

        if (shouldOutputJson(globalOpts.json) || !isTTY) {
          // Non-TTY or JSON mode: use simple API, no progress
          data = await client.importScan(opts.source);
        } else {
          // TTY: use SSE stream with progress bar
          process.stderr.write('  Scanning sources...\n');
          data = await client.importScanStream((progress) => {
            renderProgress(progress.current, progress.total, progress.imported, progress.skipped, progress.errors);
          });
          // Clear progress line and move to next line
          process.stderr.write('\r' + ' '.repeat(80) + '\r');
        }

        if (shouldOutputJson(globalOpts.json)) {
          outputJson(data);
          return;
        }

        printSuccess('Import complete');
        printKeyValue('Scanned', data.total);
        printKeyValue('Imported', data.imported);
        printKeyValue('Skipped', data.skipped);
        printKeyValue('Errors', data.errors);
        console.log();
      } catch (err) {
        // Clear any partial progress line
        if (isTTY) process.stderr.write('\r' + ' '.repeat(80) + '\r');
        printError(err instanceof Error ? err.message : 'Import failed');
        process.exit(1);
      }
    });
}
