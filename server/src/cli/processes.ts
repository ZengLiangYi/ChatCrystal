import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ProcessInfo = {
  pid: number;
  commandLine?: string | null;
  executablePath?: string | null;
};

export function parseWindowsNetstatListenPid(output: string, port: number): number | null {
  const pattern = new RegExp(`^\\s*TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$`, 'i');

  for (const line of output.split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (!match) continue;

    const pid = Number(match[1]);
    if (!Number.isNaN(pid)) {
      return pid;
    }
  }

  return null;
}

export function parsePowerShellProcessJson(output: string): ProcessInfo | null {
  const trimmed = output.trim();
  if (!trimmed) return null;

  const parsed = JSON.parse(trimmed) as
    | Record<string, unknown>
    | Array<Record<string, unknown>>;
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!item) return null;

  const pid = Number(item.ProcessId ?? item.processId ?? item.pid);
  if (Number.isNaN(pid)) return null;

  return {
    pid,
    commandLine: typeof item.CommandLine === 'string' ? item.CommandLine : null,
    executablePath: typeof item.ExecutablePath === 'string' ? item.ExecutablePath : null,
  };
}

function normalizePathForMatch(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

export function isChatCrystalServerProcess(info: ProcessInfo, trustedRoots: string[] = []): boolean {
  const haystack = `${info.commandLine ?? ''} ${info.executablePath ?? ''}`
    .replace(/\\/g, '/')
    .toLowerCase();
  const matchesTrustedRoot = trustedRoots
    .map(root => normalizePathForMatch(root))
    .filter(Boolean)
    .some(root => haystack.includes(root));
  const matchesPackageName = (
    haystack.includes('/node_modules/chatcrystal/') ||
    haystack.includes('chatcrystal')
  );

  if (!matchesTrustedRoot && !matchesPackageName) {
    return false;
  }

  const isCliServe = (
    haystack.includes('/server/src/cli/index.js') ||
    haystack.includes('/dist/server/src/cli/index.js')
  ) && /\bserve\b/.test(haystack);

  const isStandaloneServer = (
    haystack.includes('/server/src/index.js') ||
    haystack.includes('/dist/server/src/index.js')
  );

  return isCliServe || isStandaloneServer;
}

export async function findListeningPid(port: number): Promise<number | null> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'tcp'], {
        windowsHide: true,
      });
      return parseWindowsNetstatListenPid(stdout, port);
    } catch {
      return null;
    }
  }

  try {
    const { stdout } = await execFileAsync('lsof', [
      '-nP',
      `-iTCP:${port}`,
      '-sTCP:LISTEN',
      '-t',
    ]);
    const pid = Number(stdout.trim().split(/\r?\n/)[0]);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export async function getProcessInfo(pid: number): Promise<ProcessInfo | null> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { $p | Select-Object ProcessId,CommandLine,ExecutablePath | ConvertTo-Json -Compress }`,
      ], {
        windowsHide: true,
      });
      return parsePowerShellProcessJson(stdout);
    } catch {
      return null;
    }
  }

  const procCmdline = `/proc/${pid}/cmdline`;
  if (existsSync(procCmdline)) {
    try {
      const commandLine = readFileSync(procCmdline, 'utf-8')
        .replace(/\0/g, ' ')
        .trim();
      return { pid, commandLine };
    } catch {
      // Fall through to ps below.
    }
  }

  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command=']);
    return { pid, commandLine: stdout.trim() };
  } catch {
    return null;
  }
}

export async function findChatCrystalServerProcessByPort(port: number, trustedRoots: string[] = []): Promise<ProcessInfo | null> {
  const pid = await findListeningPid(port);
  if (!pid) return null;

  const info = await getProcessInfo(pid);
  if (!info || !isChatCrystalServerProcess(info, trustedRoots)) {
    return null;
  }

  return info;
}
