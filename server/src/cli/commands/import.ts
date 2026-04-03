import type { Command } from 'commander';

export function registerImportCommand(program: Command) {
  program
    .command('import')
    .description('Scan and import conversations from all sources')
    .action(async () => {
      console.log('TODO: import');
    });
}
