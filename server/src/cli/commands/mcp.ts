import type { Command } from 'commander';

export function registerMcpCommand(program: Command) {
  program
    .command('mcp')
    .description('Start MCP stdio server for AI tool integration')
    .action(async () => {
      console.log('TODO: mcp');
    });
}
