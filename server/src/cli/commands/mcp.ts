import type { Command } from 'commander';
import { resolveConnection } from '../connection.js';
import { startMcpServer } from '../mcp/server.js';

export function registerMcpCommand(program: Command) {
  program
    .command('mcp')
    .description('Start MCP stdio server for AI tool integration')
    .option('-b, --base-url <url>', 'Server base URL')
    .option('--token <token>', 'ChatCrystal API token for cloud mode')
    .action(async (opts) => {
      const globalOpts = program.opts();
      const connection = resolveConnection({
        baseUrl: opts.baseUrl ?? globalOpts.baseUrl,
        token: opts.token ?? globalOpts.token,
      });
      await startMcpServer({
        baseUrl: connection.baseUrl,
        token: connection.token,
        connectionSource: connection.source,
      });
    });
}
