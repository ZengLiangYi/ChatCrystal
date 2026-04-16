import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from 'sql.js';

type ProjectKeyInput = {
  gitRemotes?: Array<{ name: string; url: string }>;
  gitRoot?: string | null;
  cwd?: string | null;
  projectDir?: string | null;
};

type ResolvedProjectIdentity = {
  gitRemotes: Array<{ name: string; url: string }>;
  gitRoot: string | null;
  cwd: string | null;
  projectDir: string | null;
};

type SqlExecutor = Pick<Database, 'exec'>;

function shortSha(input: string) {
  return createHash('sha256').update(input).digest('hex').slice(0, 24);
}

export function normalizeRemoteUrl(remote: string): string {
  const trimmed = remote.trim().replace(/\.git$/i, '');
  const sshMatch = trimmed.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    return `${sshMatch[1].toLowerCase()}/${sshMatch[2].toLowerCase().replace(/\/+$/, '')}`;
  }

  const parsed = new URL(trimmed);
  const pathname = parsed.pathname
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  return `${parsed.hostname.toLowerCase()}/${pathname}`;
}

function normalizeFsPath(input: string): string {
  const normalized = path.resolve(input).replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function deriveProjectKey(input: ProjectKeyInput): string {
  const remotes = [...(input.gitRemotes ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const preferredRemote =
    remotes.find((remote) => remote.name === 'origin') ?? remotes[0];
  if (preferredRemote) {
    return `git:${shortSha(normalizeRemoteUrl(preferredRemote.url))}`;
  }
  if (input.gitRoot) {
    return `path:${shortSha(normalizeFsPath(input.gitRoot))}`;
  }
  const fallback = input.cwd ?? input.projectDir;
  if (!fallback) {
    throw new Error(
      'deriveProjectKey requires a git remote, git root, cwd, or projectDir',
    );
  }
  return `cwd:${shortSha(normalizeFsPath(fallback))}`;
}

function tryExecGit(args: string[], cwd: string) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export function resolveProjectIdentity(input: {
  projectDir?: string | null;
  cwd?: string | null;
}): ResolvedProjectIdentity {
  const candidates = [input.projectDir, input.cwd].filter(
    (value, index, array): value is string =>
      Boolean(value) && array.indexOf(value) === index,
  );
  const existingCandidates = candidates.filter((value) => fs.existsSync(value));
  const fallbackDir = existingCandidates[0] ?? null;

  if (!existingCandidates.length) {
    return {
      gitRemotes: [],
      gitRoot: null,
      cwd: input.cwd ?? null,
      projectDir: input.projectDir ?? null,
    };
  }

  for (const candidate of existingCandidates) {
    const gitRoot =
      tryExecGit(['rev-parse', '--show-toplevel'], candidate) || null;
    const remoteOutput = gitRoot
      ? tryExecGit(['config', '--get-regexp', '^remote\\..*\\.url$'], gitRoot)
      : '';

    const gitRemotes = remoteOutput
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [, name, url] = line.match(/^remote\.(.+)\.url\s+(.+)$/) ?? [];
        return name && url ? { name, url } : null;
      })
      .filter(
        (value): value is { name: string; url: string } => Boolean(value),
      );

    if (gitRoot || gitRemotes.length > 0) {
      return {
        gitRemotes,
        gitRoot,
        cwd: input.cwd ?? candidate,
        projectDir: input.projectDir ?? candidate,
      };
    }
  }

  return {
    gitRemotes: [],
    gitRoot: null,
    cwd: input.cwd ?? fallbackDir,
    projectDir: input.projectDir ?? fallbackDir,
  };
}

export function resolveCanonicalProjectKey(
  db: SqlExecutor,
  projectKey?: string | null,
) {
  if (!projectKey) return undefined;
  const rows = db.exec(
    `SELECT canonical_key
       FROM project_key_aliases
      WHERE alias_key = ?
      LIMIT 1`,
    [projectKey],
  );
  return rows[0]?.values.length ? String(rows[0].values[0][0]) : projectKey;
}

export function expandProjectKeyAliases(
  db: SqlExecutor,
  projectKey?: string | null,
) {
  const canonicalKey = resolveCanonicalProjectKey(db, projectKey);
  if (!canonicalKey) return new Set<string>();
  const rows = db.exec(
    `SELECT alias_key
       FROM project_key_aliases
      WHERE canonical_key = ?
      UNION
      SELECT ? AS alias_key`,
    [canonicalKey, canonicalKey],
  );
  return new Set((rows[0]?.values ?? []).map((row) => String(row[0])));
}
