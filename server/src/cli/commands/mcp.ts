import type { Command } from 'commander';
import { startMcpServer } from '../mcp/server.js';

export function registerMcpCommand(program: Command) {
  program
    .command('mcp')
    .description('Start MCP stdio server for AI tool integration')
    .option('-b, --base-url <url>', 'Server base URL')
    .action(async (opts) => {
      const globalOpts = program.opts();
      await startMcpServer(opts.baseUrl ?? globalOpts.baseUrl);
    });
}
