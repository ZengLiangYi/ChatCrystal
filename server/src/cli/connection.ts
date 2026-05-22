import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runtimePaths } from '../runtime/paths.js';
import { DEFAULT_SERVER_BASE_URL, normalizeBaseUrl } from './client.js';

export type ConnectionSource = 'explicit' | 'env' | 'saved' | 'local-default';

export type ResolvedConnection = {
  baseUrl: string;
  token?: string;
  source: ConnectionSource;
};

type SavedConnectionFile = {
  version: 1;
  baseUrl: string;
  token?: string;
  updatedAt: string;
};

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function readSavedConnection(): ResolvedConnection | null {
  if (!existsSync(runtimePaths.clientConfigPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(runtimePaths.clientConfigPath, 'utf-8')) as Partial<SavedConnectionFile>;
    if (raw.version !== 1 || !raw.baseUrl) return null;
    return {
      baseUrl: normalizeBaseUrl(raw.baseUrl),
      token: clean(raw.token),
      source: 'saved',
    };
  } catch {
    return null;
  }
}

export function saveConnection(input: { baseUrl: string; token?: string }): ResolvedConnection {
  const connection: ResolvedConnection = {
    baseUrl: normalizeBaseUrl(input.baseUrl),
    token: clean(input.token),
    source: 'saved',
  };
  const file: SavedConnectionFile = {
    version: 1,
    baseUrl: connection.baseUrl,
    token: connection.token,
    updatedAt: new Date().toISOString(),
  };

  mkdirSync(dirname(runtimePaths.clientConfigPath), { recursive: true });
  writeFileSync(runtimePaths.clientConfigPath, JSON.stringify(file, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  return connection;
}

export function clearSavedConnection(): void {
  rmSync(runtimePaths.clientConfigPath, { force: true });
}

export function resolveConnection(input: { baseUrl?: string; token?: string } = {}): ResolvedConnection {
  const explicitBaseUrl = clean(input.baseUrl);
  const explicitToken = clean(input.token);
  const envBaseUrl = clean(process.env.CHATCRYSTAL_BASE_URL);
  const envToken = clean(process.env.CHATCRYSTAL_API_TOKEN);

  if (explicitToken && !explicitBaseUrl && !envBaseUrl) {
    throw new Error('--base-url is required when --token is provided.');
  }
  if (envToken && !explicitBaseUrl && !envBaseUrl) {
    throw new Error('CHATCRYSTAL_BASE_URL is required when CHATCRYSTAL_API_TOKEN is provided.');
  }

  if (explicitBaseUrl) {
    return {
      baseUrl: normalizeBaseUrl(explicitBaseUrl),
      token: explicitToken ?? envToken,
      source: 'explicit',
    };
  }

  if (envBaseUrl) {
    return {
      baseUrl: normalizeBaseUrl(envBaseUrl),
      token: explicitToken ?? envToken,
      source: 'env',
    };
  }

  const saved = readSavedConnection();
  if (saved) return saved;

  return {
    baseUrl: DEFAULT_SERVER_BASE_URL,
    token: undefined,
    source: 'local-default',
  };
}
