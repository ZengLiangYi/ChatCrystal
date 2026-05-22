import type { Command } from 'commander';
import { CrystalClient } from '../client.js';
import type { ResolvedConnection } from '../connection.js';
import {
  clearSavedConnection,
  readSavedConnection,
  saveConnection,
} from '../connection.js';
import {
  outputJson,
  printError,
  printKeyValue,
  printSuccess,
  shouldOutputJson,
} from '../formatter.js';

export function assertCloudConnectTarget(status: { cloudMode?: boolean }): void {
  if (status.cloudMode !== true) {
    throw new Error('Connection target does not report cloud mode. Refusing to save it as a remote ChatCrystal connection.');
  }
}

export function formatRemoteStatus(connection: ResolvedConnection | null): string {
  if (!connection) return 'No saved remote connection. Using local default.';
  return `Saved remote connection: ${connection.baseUrl} (${connection.token ? 'token set' : 'token missing'})`;
}

export function redactConnectionForJson(connection: ResolvedConnection | null):
  | { source: 'local-default'; tokenSet: false }
  | { baseUrl: string; source: ResolvedConnection['source']; tokenSet: boolean } {
  if (!connection) return { source: 'local-default', tokenSet: false };
  return {
    baseUrl: connection.baseUrl,
    source: connection.source,
    tokenSet: Boolean(connection.token),
  };
}

export function registerConnectCommand(program: Command) {
  program
    .command('connect <url>')
    .description('Save a cloud ChatCrystal connection for CLI and MCP')
    .option('--token <token>', 'ChatCrystal API token for the cloud instance')
    .action(async (url, opts) => {
      const globalOpts = program.opts();
      const token = opts.token ?? globalOpts.token;

      try {
        if (!token?.trim()) {
          throw new Error('Use --token with a cloud ChatCrystal API token.');
        }

        const client = new CrystalClient({
          baseUrl: url,
          token,
          connectionSource: 'explicit',
        });
        const status = await client.status();
        assertCloudConnectTarget(status);

        const saved = saveConnection({ baseUrl: url, token });

        if (shouldOutputJson(globalOpts.json)) {
          outputJson(redactConnectionForJson(saved));
          return;
        }

        printSuccess('Saved ChatCrystal cloud connection');
        printKeyValue('Base URL', saved.baseUrl);
        printKeyValue('Mode', client.getModeLabel(status));
        console.log();
      } catch (err) {
        printError(err instanceof Error ? err.message : 'Failed to connect');
        process.exit(1);
      }
    });

  program
    .command('disconnect')
    .description('Remove the saved ChatCrystal cloud connection')
    .action(() => {
      const globalOpts = program.opts();
      clearSavedConnection();

      if (shouldOutputJson(globalOpts.json)) {
        outputJson({ disconnected: true });
        return;
      }

      printSuccess('Removed saved ChatCrystal connection');
      console.log();
    });

  const remote = program
    .command('remote')
    .description('Manage the saved ChatCrystal remote connection');

  remote
    .command('status')
    .description('Show saved remote connection status')
    .action(() => {
      const globalOpts = program.opts();
      const saved = readSavedConnection();

      if (shouldOutputJson(globalOpts.json)) {
        outputJson(redactConnectionForJson(saved));
        return;
      }

      console.log(formatRemoteStatus(saved));
    });
}
