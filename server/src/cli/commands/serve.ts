import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFileSync, openSync, mkdirSync } from 'node:fs';
import type { Command } from 'commander';
import { DEFAULT_SERVER_BASE_URL, normalizeBaseUrl, readPidFile, removePidFile } from '../client.js';
import {
  findChatCrystalServerProcessByPort,
  getProcessInfo,
  isChatCrystalServerProcess,
  type ProcessInfo,
} from '../processes.js';
import { runtimePaths } from '../../runtime/paths.js';
import { printSuccess, printError, printKeyValue, printWarning } from '../formatter.js';

type StopDaemonErrorResult = {
  level: 'warning' | 'error';
  shouldExit: boolean;
  shouldRemovePidFile: boolean;
  message: string;
};

export function classifyStopDaemonError(err: unknown): StopDaemonErrorResult {
  const errno = err as NodeJS.ErrnoException;
  if (errno.code === 'ESRCH') {
    return {
      level: 'warning',
      shouldExit: false,
      shouldRemovePidFile: true,
      message: 'Process not found. Cleaned up stale PID file.',
    };
  }

  return {
    level: 'error',
    shouldExit: true,
    shouldRemovePidFile: false,
    message: `Failed to stop server: ${err instanceof Error ? err.message : err}`,
  };
}

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
    .description('Stop the running server')
    .action(async () => {
      await stopDaemon(program.opts().baseUrl || DEFAULT_SERVER_BASE_URL);
    });

  serve
    .command('status')
    .description('Check if the server is running')
    .action(async () => {
      await checkStatus(program.opts().baseUrl || DEFAULT_SERVER_BASE_URL);
    });
}

async function startForeground(port: number) {
  process.env.CRYSTAL_CLI = 'true';
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

  const serverEntry = resolve(import.meta.dirname, '../../index.js');
  const dataDir = runtimePaths.dataDir;
  try { mkdirSync(dataDir, { recursive: true }); } catch { /* ignore */ }

  // Redirect stdout/stderr to log file (Fastify's pino logger needs a writable stdout)
  const logFd = openSync(runtimePaths.logPath, 'a');
  const child = spawn(process.execPath, [serverEntry], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, PORT: String(port) },
  });
  child.unref();
  try {
    writeFileSync(runtimePaths.pidPath, String(child.pid), 'utf-8');
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

export function getPortFromBaseUrl(baseUrl: string): number {
  const url = new URL(normalizeBaseUrl(baseUrl));
  if (url.port) {
    return Number(url.port);
  }
  return url.protocol === 'https:' ? 443 : 80;
}

async function waitForServerToStop(baseUrl: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(500) });
      if (!res.ok) {
        return true;
      }
    } catch {
      return true;
    }

    await new Promise(resolve => setTimeout(resolve, 150));
  }

  return false;
}

async function stopProcess(info: ProcessInfo, baseUrl: string, label: string): Promise<'stopped' | 'not-found' | 'still-running'> {
  try {
    process.kill(info.pid, 'SIGTERM');
    const stopped = await waitForServerToStop(baseUrl);
    if (!stopped) {
      printWarning(`Sent SIGTERM to ${label} (PID: ${info.pid}), but ${baseUrl} is still responding.`);
      return 'still-running';
    }
    printSuccess(`Server stopped (${label} PID: ${info.pid})`);
    return 'stopped';
  } catch (err) {
    const result = classifyStopDaemonError(err);
    if (result.level === 'warning') {
      printWarning(result.message);
      return 'not-found';
    }

    printError(`Failed to stop ${label} (PID: ${info.pid}): ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

async function stopDaemon(baseUrl: string) {
  const pid = readPidFile();
  const port = getPortFromBaseUrl(baseUrl);

  if (pid) {
    const pidInfo = await getProcessInfo(pid);
    if (!pidInfo || !isChatCrystalServerProcess(pidInfo, [
      runtimePaths.packageRoot,
      runtimePaths.appRoot,
    ])) {
      printWarning('PID file did not point to a ChatCrystal server. Cleaned up stale PID file.');
      removePidFile();
    } else {
      const result = await stopProcess(pidInfo, baseUrl, 'PID file');
      removePidFile();
      if (result === 'stopped') {
        return;
      }
    }
  }

  if (!pid) {
    printWarning('No server PID file found. Checking listening port fallback.');
  }

  const portOwner = await findChatCrystalServerProcessByPort(port, [
    runtimePaths.packageRoot,
    runtimePaths.appRoot,
  ]);
  if (!portOwner) {
    if (pid) {
      printWarning(`No ChatCrystal server was found on port ${port}. Nothing else to stop.`);
    } else {
      printWarning(`No ChatCrystal server found on port ${port}. Nothing to stop.`);
    }
    return;
  }

  const result = await stopProcess(portOwner, baseUrl, `port ${port}`);
  if (result === 'stopped' || result === 'not-found') {
    return;
  }

  process.exit(1);
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
      return;
    }
    printError(`Server responded with status ${res.status}`);
  } catch {
    printError(`Server is not running at ${baseUrl}`);
  }
}
