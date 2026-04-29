import type { Command } from 'commander';
import { CrystalClient } from '../client.js';
import {
  shouldOutputJson, outputJson,
  printHeader, printTable, truncate,
} from '../formatter.js';
import { isInteractive } from '../interactive.js';
import { renderApp } from '../ui/renderApp.js';

export function registerConversationsCommand(program: Command) {
  program
    .command('conversations')
    .description('List conversations')
    .option('-s, --source <source>', 'Filter by source (claude-code, codex, cursor)')
    .option('--status <status>', 'Filter by status (imported, summarizing, summarized, filtered, error)')
    .option('-q, --search <query>', 'Search by project name or slug')
    .option('-n, --limit <n>', 'Number of results', '20')
    .option('--offset <n>', 'Offset for pagination', '0')
    .action(async (opts) => {
      const globalOpts = program.opts();
      const client = new CrystalClient(globalOpts.baseUrl);

      try {
        // Interactive mode
        if (isInteractive(globalOpts)) {
          await renderApp(client, {
            type: 'conversations',
            props: {
              source: opts.source,
              status: opts.status,
              search: opts.search,
            },
          });
          return;
        }

        const data = await client.getConversations({
          source: opts.source,
          status: opts.status,
          search: opts.search,
          limit: Number(opts.limit),
          offset: Number(opts.offset),
        });

        if (shouldOutputJson(globalOpts.json)) {
          outputJson(data);
          return;
        }

        printHeader(`Conversations (${data.total} total)`);
        if (data.items.length === 0) {
          console.log('  No conversations found.\n');
          return;
        }

        printTable(
          ['ID', 'Source', 'Project', 'Msgs', 'Status', 'Last Active'],
          data.items.map((c) => [
            c.id,
            c.source,
            truncate(c.project_name || '', 20),
            c.message_count,
            c.status,
            c.last_message_at ? new Date(c.last_message_at).toLocaleDateString() : '',
          ]),
        );

        if (data.total > data.offset + data.items.length) {
          console.log(`  Showing ${data.offset + 1}-${data.offset + data.items.length} of ${data.total}. Use --offset ${data.offset + data.items.length} to see more.\n`);
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : 'Failed to list conversations');
        process.exit(1);
      }
    });
}
