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

      try {
        const data = await client.importScan(opts.source);

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
        printError(err instanceof Error ? err.message : 'Import failed');
        process.exit(1);
      }
    });
}
