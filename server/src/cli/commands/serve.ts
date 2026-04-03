import type { Command } from 'commander';

export function registerServeCommand(program: Command) {
  program
    .command('serve')
    .description('Start the ChatCrystal web server')
    .action(async () => {
      console.log('TODO: serve');
    });
}
