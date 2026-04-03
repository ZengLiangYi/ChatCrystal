import type { Command } from 'commander';
import { startMcpServer } from '../mcp/server.js';

export function registerMcpCommand(program: Command) {
  program
    .command('mcp')
    .description('Start MCP stdio server for AI tool integration')
    .action(async () => {
      const opts = program.opts();
      await startMcpServer(opts.baseUrl);
    });
}
