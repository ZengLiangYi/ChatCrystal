import type { Command } from 'commander';

export function registerSearchCommand(program: Command) {
  program
    .command('search <query>')
    .description('Semantic search across notes')
    .action(async () => {
      console.log('TODO: search');
    });
}
