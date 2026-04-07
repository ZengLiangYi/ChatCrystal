import type { Command } from 'commander';
import { CrystalClient } from '../client.js';
import {
  shouldOutputJson, outputJson,
  printSuccess, printError, printKeyValue,
} from '../formatter.js';

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
        if (isTTY && !shouldOutputJson(globalOpts.json)) {
          // TTY: Ink panel
          const { renderImportPanel } = await import('../ui/ImportPanel.js');
          await renderImportPanel(client);
          process.exit(0);
          return;
        }

        // Non-TTY: use SSE stream with text output (not blocking POST)
        const data = await client.importScanStream((progress) => {
          if (shouldOutputJson(globalOpts.json)) return;
          // Print progress updates periodically
          if (progress.current === progress.total || progress.current % 50 === 0) {
            process.stderr.write(
              `\rScanning... ${progress.current}/${progress.total} | imported:${progress.imported} skipped:${progress.skipped} errors:${progress.errors}`
            );
          }
        });

        if (!shouldOutputJson(globalOpts.json)) {
          process.stderr.write('\r' + ' '.repeat(80) + '\r');
        }

        if (shouldOutputJson(globalOpts.json)) {
          outputJson(data);
        } else {
          printSuccess('Import complete');
          printKeyValue('Scanned', data.total);
          printKeyValue('Imported', data.imported);
          printKeyValue('Skipped', data.skipped);
          printKeyValue('Errors', data.errors);
          console.log();
        }
        process.exit(0);
      } catch (err) {
        printError(err instanceof Error ? err.message : 'Import failed');
        process.exit(1);
      }
    });
}
