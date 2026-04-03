import type { Command } from 'commander';
import { CrystalClient } from '../client.js';
import {
  shouldOutputJson, outputJson,
  printHeader, printKeyValue, printError,
} from '../formatter.js';

export function registerStatusCommand(program: Command) {
  program
    .command('status')
    .description('Show server status and database statistics')
    .action(async () => {
      const opts = program.opts();
      const client = new CrystalClient(opts.baseUrl);

      try {
        const data = await client.status();

        if (shouldOutputJson(opts.json)) {
          outputJson(data);
          return;
        }

        printHeader('ChatCrystal Status');
        printKeyValue('Server', data.server ? 'running' : 'stopped');
        printKeyValue('Database', data.database ? 'connected' : 'disconnected');
        printKeyValue('Conversations', data.stats.totalConversations);
        printKeyValue('Notes', data.stats.totalNotes);
        printKeyValue('Tags', data.stats.totalTags);

        if (data.recentNotes.length > 0) {
          console.log(`\n  Recent notes:`);
          for (const note of data.recentNotes) {
            console.log(`    #${note.id} ${note.title} (${note.project_name})`);
          }
        }
        console.log();
      } catch (err) {
        printError(err instanceof Error ? err.message : 'Failed to get status');
        process.exit(1);
      }
    });
}
