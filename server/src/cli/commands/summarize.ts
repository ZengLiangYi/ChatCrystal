import type { Command } from 'commander';

export function registerSummarizeCommand(program: Command) {
  program
    .command('summarize')
    .description('Summarize conversations into notes')
    .action(async () => {
      console.log('TODO: summarize');
    });
}
