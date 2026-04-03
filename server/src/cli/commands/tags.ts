import type { Command } from 'commander';
import { CrystalClient } from '../client.js';
import {
  shouldOutputJson, outputJson,
  printHeader, printTable, printError,
} from '../formatter.js';

export function registerTagsCommand(program: Command) {
  program
    .command('tags')
    .description('List all tags with usage counts')
    .action(async () => {
      const globalOpts = program.opts();
      const client = new CrystalClient(globalOpts.baseUrl);

      try {
        const tags = await client.listTags();

        if (shouldOutputJson(globalOpts.json)) {
          outputJson(tags);
          return;
        }

        if (tags.length === 0) {
          console.log('\n  No tags found.\n');
          return;
        }

        printHeader('Tags');
        printTable(
          ['Tag', 'Notes'],
          tags.map((t) => [t.name, t.count]),
        );
      } catch (err) {
        printError(err instanceof Error ? err.message : 'Failed to list tags');
        process.exit(1);
      }
    });
}
