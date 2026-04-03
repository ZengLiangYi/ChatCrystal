import type { Command } from 'commander';

export function registerStatusCommand(program: Command) {
  program
    .command('status')
    .description('Show server status and database statistics')
    .action(async () => {
      console.log('TODO: status');
    });
}
