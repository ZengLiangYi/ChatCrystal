import type { Command } from 'commander';
import { resetStoredAuthForLocalAdmin } from '../../services/auth.js';
import { CrystalClient } from '../client.js';
import { resolveConnection, saveConnection } from '../connection.js';
import {
  outputJson,
  printError,
  printKeyValue,
  printSuccess,
  shouldOutputJson,
} from '../formatter.js';

export function registerTokenCommand(program: Command) {
  const token = program
    .command('token')
    .description('Manage ChatCrystal cloud API tokens');

  token
    .command('rotate <next-token>')
    .description('Rotate the cloud API token')
    .option('--current <token>', 'Current ChatCrystal API token')
    .action(async (nextToken, opts) => {
      const globalOpts = program.opts();

      try {
        const connection = resolveConnection({
          baseUrl: globalOpts.baseUrl,
          token: globalOpts.token,
        });
        const currentToken = opts.current?.trim() || connection.token;
        if (!currentToken) {
          throw new Error('Current token is required. Use --current or configure a saved/env token.');
        }

        const client = new CrystalClient({
          baseUrl: connection.baseUrl,
          token: currentToken,
          connectionSource: connection.source,
        });
        const result = await client.rotateToken(currentToken, nextToken);

        if (connection.source === 'saved') {
          saveConnection({ baseUrl: connection.baseUrl, token: nextToken });
        }

        if (shouldOutputJson(globalOpts.json)) {
          outputJson(result);
          return;
        }

        printSuccess('Token rotated');
        printKeyValue('Base URL', connection.baseUrl);
        if (connection.source === 'saved') {
          printKeyValue('Saved connection', 'updated');
        }
        console.log();
      } catch (err) {
        printError(err instanceof Error ? err.message : 'Failed to rotate token');
        process.exit(1);
      }
    });

  token
    .command('reset')
    .description('Reset stored server auth on this machine/container')
    .option('-y, --yes', 'Confirm local auth reset')
    .action(async (opts) => {
      const globalOpts = program.opts();

      try {
        if (!opts.yes) {
          throw new Error('Use --yes to reset local stored server auth.');
        }

        await resetStoredAuthForLocalAdmin();

        if (shouldOutputJson(globalOpts.json)) {
          outputJson({ reset: true });
          return;
        }

        printSuccess('Reset local stored server auth');
        console.log();
      } catch (err) {
        printError(err instanceof Error ? err.message : 'Failed to reset token');
        process.exit(1);
      }
    });
}
