import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import type { Command } from 'commander';
import { readPidFile, removePidFile } from '../client.js';
import { printSuccess, printError, printKeyValue } from '../formatter.js';

export function registerServeCommand(program: Command) {
  const serve = program
    .command('serve')
    .description('Start the ChatCrystal web server')
    .option('-p, --port <port>', 'Port number', '3721')
    .option('-d, --daemon', 'Run in background (daemon mode)')
    .action(async (opts) => {
      if (opts.daemon) {
        await startDaemon(Number(opts.port));
      } else {
        await startForeground(Number(opts.port));
      }
    });

  serve
    .command('stop')
    .description('Stop the background server')
    .action(async () => {
      await stopDaemon();
    });

  serve
    .command('status')
    .description('Check if the server is running')
    .action(async () => {
      await checkStatus(program.opts().baseUrl || 'http://localhost:3721');
    });
}

async function startForeground(port: number) {
  const { createServer } = await import('../../index.js');
  const { shutdown } = await createServer({ port });

  const handle = () => {
    shutdown().then(() => process.exit(0));
  };
  process.on('SIGINT', handle);
  process.on('SIGTERM', handle);
}

async function startDaemon(port: number) {
  const baseUrl = `http://localhost:${port}`;
  try {
    const res = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      printSuccess(`Server already running at ${baseUrl}`);
      return;
    }
  } catch { /* not running */ }

  const serverEntry = resolve(import.meta.dirname, '../index.js');
  const child = spawn(process.execPath, [serverEntry], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PORT: String(port) },
  });
  child.unref();

  const dataDir = resolve(import.meta.dirname, '../../../../../data');
  const pidFile = resolve(dataDir, 'crystal.pid');
  try {
    writeFileSync(pidFile, String(child.pid), 'utf-8');
  } catch { /* non-fatal */ }

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const res = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        printSuccess(`Server started in background at ${baseUrl} (PID: ${child.pid})`);
        return;
      }
    } catch { /* keep polling */ }
  }

  printError('Server failed to start within 10 seconds.');
  process.exit(1);
}

async function stopDaemon() {
  const dataDir = resolve(import.meta.dirname, '../../../../../data');
  const pid = readPidFile(dataDir);

  if (!pid) {
    printError('No server PID file found. Is the server running in daemon mode?');
    process.exit(1);
  }

  try {
    process.kill(pid, 'SIGTERM');
    printSuccess(`Server stopped (PID: ${pid})`);
    removePidFile(dataDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
      printError(`Process ${pid} not found. Cleaning up stale PID file.`);
      removePidFile(dataDir);
    } else {
      printError(`Failed to stop server: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  }
}

async function checkStatus(baseUrl: string) {
  try {
    const res = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      printSuccess(`Server is running at ${baseUrl}`);
      const json = await res.json() as { data: { stats: Record<string, number> } };
      const { stats } = json.data;
      printKeyValue('Conversations', stats.totalConversations);
      printKeyValue('Notes', stats.totalNotes);
      printKeyValue('Tags', stats.totalTags);
    } else {
      printError(`Server responded with status ${res.status}`);
    }
  } catch {
    printError(`Server is not running at ${baseUrl}`);
  }
}
