import type { Command } from 'commander';

export function registerTagsCommand(program: Command) {
  program
    .command('tags')
    .description('List all tags with usage counts')
    .action(async () => {
      console.log('TODO: tags');
    });
}
