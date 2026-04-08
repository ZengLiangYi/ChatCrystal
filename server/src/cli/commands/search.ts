import type { Command } from 'commander';
import { CrystalClient } from '../client.js';
import {
  shouldOutputJson, outputJson,
  printHeader, printTable, printError, truncate,
} from '../formatter.js';
import { isInteractive } from '../interactive.js';
import { renderApp } from '../ui/renderApp.js';

export function registerSearchCommand(program: Command) {
  program
    .command('search <query>')
    .description('Semantic search across notes')
    .option('-l, --limit <n>', 'Max results', '10')
    .action(async (query, opts) => {
      const globalOpts = program.opts();
      const client = new CrystalClient(globalOpts.baseUrl);

      try {
        // Interactive mode
        if (isInteractive(globalOpts)) {
          await renderApp(client, {
            type: 'search',
            props: { initialQuery: query },
          });
          return;
        }

        const results = await client.search(query, Number(opts.limit));

        if (shouldOutputJson(globalOpts.json)) {
          outputJson(results);
          return;
        }

        if (results.length === 0) {
          console.log('\n  No results found.\n');
          return;
        }

        printHeader(`Search: "${query}"`);
        printTable(
          ['#', 'Score', 'Title', 'Project', 'Tags'],
          results.map((r, i) => [
            i + 1,
            r.score.toFixed(3),
            truncate(r.title, 40),
            truncate(r.project_name, 20),
            r.tags.slice(0, 3).join(', '),
          ]),
        );
      } catch (err) {
        printError(err instanceof Error ? err.message : 'Search failed');
        process.exit(1);
      }
    });
}
