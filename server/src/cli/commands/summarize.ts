import type { Command } from 'commander';
import { CrystalClient } from '../client.js';
import {
  shouldOutputJson, outputJson,
  printSuccess, printError, printKeyValue,
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
          printError('Provide a conversation ID or use --all / --retry-errors');
          process.exit(1);
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
