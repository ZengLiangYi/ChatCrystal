import type { Command } from 'commander';
import { CrystalClient } from '../client.js';
import { isLocalBaseUrl } from '../../runtime/cloud.js';
import { runRemoteImport } from '../../services/remoteImport.js';
import { resolveConnection, type ConnectionSource } from '../connection.js';
import {
  shouldOutputJson, outputJson,
  printSuccess, printError, printKeyValue,
} from '../formatter.js';

export function shouldUseRemoteImport(
  baseUrl: string,
  status: { cloudMode?: boolean },
  connectionSource: ConnectionSource | string,
): boolean {
  if (status.cloudMode === true) {
    return true;
  }

  if (isLocalBaseUrl(baseUrl) && connectionSource === 'local-default') {
    return false;
  }

  if (isLocalBaseUrl(baseUrl)) {
    throw new Error('Refusing local import for a loopback saved/env/explicit connection that did not report cloud mode. This may be an SSH tunnel or wrong local instance; use the implicit local default or connect to a cloud-mode server.');
  }

  throw new Error('Refusing remote import because the target server did not report cloud mode. Connect to a ChatCrystal cloud-mode server before uploading local histories.');
}

export function registerImportCommand(program: Command) {
  program
    .command('import')
    .description('Scan and import conversations from all sources')
    .option('-s, --source <source>', 'Import from specific source (claude-code, codex, cursor, trae, copilot)')
    .option('-y, --yes', 'Skip confirmation prompt for remote import upload')
    .action(async (opts) => {
      const globalOpts = program.opts();
      const connection = resolveConnection({ baseUrl: globalOpts.baseUrl, token: globalOpts.token });
      const client = new CrystalClient({
        baseUrl: connection.baseUrl,
        token: connection.token,
        connectionSource: connection.source,
      });
      const isTTY = process.stdout.isTTY ?? false;

      try {
        const status = await client.status();
        const remoteMode = shouldUseRemoteImport(connection.baseUrl, status, connection.source);

        if (remoteMode) {
          if (!opts.yes) {
            if (shouldOutputJson(globalOpts.json) || !process.stdin.isTTY) {
              throw new Error('Use --yes when importing to a remote cloud instance from non-interactive output');
            }
            console.log(`\nRemote import target: ${connection.baseUrl}`);
            process.stdout.write('Scan local AI histories and upload parsed conversations? Type "import" to confirm: ');
            const answer = await new Promise<string>((resolve) => {
              process.stdin.resume();
              process.stdin.once('data', (data) => {
                process.stdin.pause();
                resolve(String(data).trim());
              });
            });
            if (answer !== 'import') {
              console.log('\n  Cancelled.\n');
              return;
            }
          }

          const data = await runRemoteImport(client, { source: opts.source }, (progress) => {
            if (shouldOutputJson(globalOpts.json)) return;
            process.stderr.write(
              `\rUploading... ${progress.uploaded}/${progress.scanned} | imported:${progress.imported} replaced:${progress.replaced} skipped:${progress.skipped} errors:${progress.errors}`,
            );
          });

          if (shouldOutputJson(globalOpts.json)) {
            outputJson(data);
          } else {
            process.stderr.write('\r' + ' '.repeat(100) + '\r');
            printSuccess('Remote import complete');
            printKeyValue('Target', connection.baseUrl);
            printKeyValue('Scanned', data.scanned);
            printKeyValue('Uploaded', data.uploaded);
            printKeyValue('Imported', data.imported);
            printKeyValue('Replaced', data.replaced);
            printKeyValue('Skipped', data.skipped);
            printKeyValue('Errors', data.errors);
            printKeyValue('Local parse errors', data.localErrors);
            console.log();
          }
          process.exit(0);
          return;
        }

        if (isTTY && !shouldOutputJson(globalOpts.json)) {
          // TTY: Ink panel
          const { renderImportPanel } = await import('../ui/ImportPanel.js');
          await renderImportPanel(client);
          process.exit(0);
          return;
        }

        // Non-TTY: use SSE stream with text output (not blocking POST)
        const data = await client.importScanStream((progress) => {
          if (shouldOutputJson(globalOpts.json)) return;
          // Print progress updates periodically
          if (progress.current === progress.total || progress.current % 50 === 0) {
            process.stderr.write(
              `\rScanning... ${progress.current}/${progress.total} | imported:${progress.imported} skipped:${progress.skipped} errors:${progress.errors}`
            );
          }
        });

        if (!shouldOutputJson(globalOpts.json)) {
          process.stderr.write('\r' + ' '.repeat(80) + '\r');
        }

        if (shouldOutputJson(globalOpts.json)) {
          outputJson(data);
        } else {
          printSuccess('Import complete');
          printKeyValue('Scanned', data.total);
          printKeyValue('Imported', data.imported);
          printKeyValue('Skipped', data.skipped);
          printKeyValue('Errors', data.errors);
          console.log();
        }
        process.exit(0);
      } catch (err) {
        printError(err instanceof Error ? err.message : 'Import failed');
        process.exit(1);
      }
    });
}
