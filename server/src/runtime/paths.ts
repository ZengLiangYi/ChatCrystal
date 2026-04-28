import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { config } from 'dotenv';

type PackageJson = {
  workspaces?: unknown;
};

type PathResolver = Pick<typeof path, 'isAbsolute' | 'resolve'>;

type RuntimePathOptions = {
  envDataDir?: string;
  packageRoot: string;
  workspaceRoot?: string | null;
  homeDir?: string;
  pathResolver?: PathResolver;
};

function readPackageJson(dir: string): PackageJson | null {
  const manifestPath = path.resolve(dir, 'package.json');
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
  let current = path.resolve(startDir);

  while (true) {
    if (readPackageJson(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir, '../../..');
    }
    current = parent;
  }
}

function findWorkspaceRoot(packageRoot: string): string | null {
  let current = path.dirname(packageRoot);

  while (true) {
    const manifest = readPackageJson(current);
    if (manifest?.workspaces) {
      return current;
    }

    const parent = path.dirname(current);
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
  const pathResolver = options.pathResolver ?? path;

  if (options.envDataDir && pathResolver.isAbsolute(options.envDataDir)) {
    return options.envDataDir;
  }

  if (options.envDataDir) {
    return pathResolver.resolve(appRoot, options.envDataDir);
  }

  return pathResolver.resolve(homeDir, '.chatcrystal', 'data');
}

const packageRoot = findNearestPackageRoot(import.meta.dirname);
const workspaceRoot = findWorkspaceRoot(packageRoot);
const appRoot = workspaceRoot ?? packageRoot;

for (const envPath of unique([path.resolve(appRoot, '.env'), path.resolve(packageRoot, '.env')])) {
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
  dbPath: path.resolve(dataDir, 'chatcrystal.db'),
  configPath: path.resolve(dataDir, 'config.json'),
  pidPath: path.resolve(dataDir, 'crystal.pid'),
  logPath: path.resolve(dataDir, 'crystal-server.log'),
};
