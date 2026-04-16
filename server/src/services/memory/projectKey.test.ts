import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveProjectKey,
  expandProjectKeyAliases,
  normalizeRemoteUrl,
  resolveProjectIdentity,
  resolveCanonicalProjectKey,
} from './projectKey.js';

test('normalizeRemoteUrl collapses ssh and https remotes to the same canonical form', () => {
  assert.equal(
    normalizeRemoteUrl('git@github.com:OpenAI/ChatCrystal.git'),
    normalizeRemoteUrl('https://github.com/openai/chatcrystal'),
  );
});

test('deriveProjectKey prefers git remotes over path fallbacks', () => {
  const key = deriveProjectKey({
    gitRemotes: [{ name: 'origin', url: 'git@github.com:OpenAI/ChatCrystal.git' }],
    gitRoot: 'C:\\Users\\Rayner\\Project\\ChatCrystal',
    cwd: 'C:\\Users\\Rayner\\Project\\ChatCrystal\\server',
  });

  assert.match(key, /^git:/);
});

test('deriveProjectKey falls back to normalized git root and then cwd', () => {
  const pathKey = deriveProjectKey({
    gitRoot: 'C:\\Users\\Rayner\\Project\\ChatCrystal',
  });
  const cwdKey = deriveProjectKey({
    cwd: '/tmp/chatcrystal-sandbox',
  });

  assert.match(pathKey, /^path:/);
  assert.match(cwdKey, /^cwd:/);
});

test('resolveCanonicalProjectKey normalizes alias keys before recall/writeback', () => {
  const db = {
    exec(sql: string, params: unknown[]) {
      if (sql.includes('SELECT canonical_key')) {
        const [alias] = params;
        return [{
          columns: ['canonical_key'],
          values: alias === 'path:legacy-chatcrystal' ? [['git:canonical-chatcrystal']] : [],
        }];
      }
      return [{
        columns: ['alias_key'],
        values: [['git:canonical-chatcrystal'], ['path:legacy-chatcrystal']],
      }];
    },
  };

  assert.equal(
    resolveCanonicalProjectKey(db as never, 'path:legacy-chatcrystal'),
    'git:canonical-chatcrystal',
  );
  assert.deepEqual(
    [...expandProjectKeyAliases(db as never, 'git:canonical-chatcrystal')].sort(),
    ['git:canonical-chatcrystal', 'path:legacy-chatcrystal'],
  );
});

test('resolveProjectIdentity falls through to cwd git metadata when project_dir is stale', () => {
  const identity = resolveProjectIdentity({
    projectDir: 'C:\\definitely-missing-chatcrystal-fixture',
    cwd: process.cwd(),
  });

  assert.equal(identity.cwd, process.cwd());
  assert.notEqual(identity.gitRoot, null);
});
