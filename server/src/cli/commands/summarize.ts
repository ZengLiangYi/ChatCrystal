import type { Command } from 'commander';
import { CrystalClient } from '../client.js';
import {
  shouldOutputJson, outputJson,
  printSuccess, printError, printKeyValue, printHeader, printTable, truncate,
} from '../formatter.js';

export function registerSummarizeCommand(program: Command) {
  program
    .command('summarize [id]')
    .description('Summarize conversations into notes')
    .option('-a, --all', 'Summarize all unsummarized conversations')
    .option('--retry-errors', 'Reset error conversations and allow retry')
    .action(async (id, opts) => {
      const globalOpts = program.opts();
      const client = new CrystalClient(globalOpts.baseUrl);

      try {
        if (opts.retryErrors) {
          const data = await client.resetErrors();

          if (shouldOutputJson(globalOpts.json)) {
            outputJson(data);
            return;
          }

          printSuccess(`Reset ${data.reset} error conversations to imported status`);
          console.log();
          return;
        }

        if (opts.all) {
          const isTTY = process.stdout.isTTY ?? false;

          if (isTTY && !shouldOutputJson(globalOpts.json)) {
            const { renderSummarizePanel } = await import('../ui/SummarizePanel.js');
            await renderSummarizePanel(client);
            process.exit(0);
          }

          const data = await client.summarizeBatch();

          if (shouldOutputJson(globalOpts.json)) {
            outputJson(data);
            return;
          }

          printSuccess('Batch summarization queued');
          printKeyValue('Queued', data.queued);
          printKeyValue('Total unsummarized', data.total);
          console.log();
          return;
        }

        if (!id) {
          // No ID and no flags: show unsummarized conversations to help user pick
          const data = await client.getConversations({ status: 'imported', limit: 15 });

          if (shouldOutputJson(globalOpts.json)) {
            outputJson(data);
            return;
          }

          if (data.total === 0) {
            printSuccess('All conversations have been summarized!');
            console.log();
            return;
          }

          printHeader(`Unsummarized conversations (${data.total} total)`);
          printTable(
            ['ID', 'Source', 'Project', 'Msgs'],
            data.items.map((c) => [
              c.id,
              c.source,
              truncate(c.project_name || '', 20),
              c.message_count,
            ]),
          );
          console.log('  Usage: crystal summarize <ID>');
          console.log('     or: crystal summarize --all\n');
          return;
        }

        const data = await client.summarize(id);

        if (shouldOutputJson(globalOpts.json)) {
          outputJson(data);
          return;
        }

        printSuccess(`Summarization queued for conversation ${id}`);
        console.log();
      } catch (err) {
        printError(err instanceof Error ? err.message : 'Summarize failed');
        process.exit(1);
      }
    });
}
