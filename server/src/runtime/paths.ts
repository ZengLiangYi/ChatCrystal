import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { config } from 'dotenv';

type PackageJson = {
  workspaces?: unknown;
};

type RuntimePathOptions = {
  envDataDir?: string;
  packageRoot: string;
  workspaceRoot?: string | null;
  homeDir?: string;
};

function readPackageJson(dir: string): PackageJson | null {
  const manifestPath = resolve(dir, 'package.json');
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as PackageJson;
  } catch {
    return null;
  }
}

function findNearestPackageRoot(startDir: string): string {
  let current = resolve(startDir);

  while (true) {
    if (readPackageJson(current)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return resolve(startDir, '../../..');
    }
    current = parent;
  }
}

function findWorkspaceRoot(packageRoot: string): string | null {
  let current = dirname(packageRoot);

  while (true) {
    const manifest = readPackageJson(current);
    if (manifest?.workspaces) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function resolveDataDirForTest(options: RuntimePathOptions): string {
  const appRoot = options.workspaceRoot ?? options.packageRoot;
  const homeDir = options.homeDir ?? homedir();

  if (options.envDataDir && isAbsolute(options.envDataDir)) {
    return options.envDataDir;
  }

  if (options.envDataDir) {
    return resolve(appRoot, options.envDataDir);
  }

  return resolve(homeDir, '.chatcrystal', 'data');
}

const packageRoot = findNearestPackageRoot(import.meta.dirname);
const workspaceRoot = findWorkspaceRoot(packageRoot);
const appRoot = workspaceRoot ?? packageRoot;

for (const envPath of unique([resolve(appRoot, '.env'), resolve(packageRoot, '.env')])) {
  if (existsSync(envPath)) {
    config({ path: envPath });
    break;
  }
}

const dataDir = resolveDataDirForTest({
  envDataDir: process.env.DATA_DIR,
  packageRoot,
  workspaceRoot,
});

export const runtimePaths = {
  appRoot,
  packageRoot,
  workspaceRoot,
  dataDir,
  dbPath: resolve(dataDir, 'chatcrystal.db'),
  configPath: resolve(dataDir, 'config.json'),
  pidPath: resolve(dataDir, 'crystal.pid'),
  logPath: resolve(dataDir, 'crystal-server.log'),
};
