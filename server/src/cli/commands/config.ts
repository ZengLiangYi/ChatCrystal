import type { Command } from 'commander';

export function registerConfigCommand(program: Command) {
  program
    .command('config')
    .description('View and modify configuration')
    .action(async () => {
      console.log('TODO: config');
    });
}
