import type { Command } from 'commander';

export function registerNotesCommand(program: Command) {
  program
    .command('notes')
    .description('List, view, and explore notes')
    .action(async () => {
      console.log('TODO: notes');
    });
}
