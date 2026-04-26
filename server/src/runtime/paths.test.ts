import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDataDirForTest } from './paths.js';

test('resolveDataDirForTest uses absolute DATA_DIR verbatim', () => {
  const dataDir = resolveDataDirForTest({
    envDataDir: 'C:/data/chatcrystal',
    packageRoot: 'C:/pkg/server',
    workspaceRoot: 'C:/pkg',
    homeDir: 'C:/Users/Rayner',
  });

  assert.equal(dataDir, 'C:/data/chatcrystal');
});

test('resolveDataDirForTest resolves relative DATA_DIR against workspace root', () => {
  const dataDir = resolveDataDirForTest({
    envDataDir: './data',
    packageRoot: 'C:/repo/server',
    workspaceRoot: 'C:/repo',
    homeDir: 'C:/Users/Rayner',
  });

  assert.equal(dataDir, 'C:\\repo\\data');
});

test('resolveDataDirForTest falls back to package root when no workspace root exists', () => {
  const dataDir = resolveDataDirForTest({
    envDataDir: './data',
    packageRoot: 'C:/global/node_modules/chatcrystal',
    workspaceRoot: null,
    homeDir: 'C:/Users/Rayner',
  });

  assert.equal(dataDir, 'C:\\global\\node_modules\\chatcrystal\\data');
});

test('resolveDataDirForTest defaults to ~/.chatcrystal/data when DATA_DIR is unset in a repo checkout', () => {
  const dataDir = resolveDataDirForTest({
    packageRoot: 'C:/repo/server',
    workspaceRoot: 'C:/repo',
    homeDir: 'C:/Users/Rayner',
  });

  assert.equal(dataDir, 'C:\\Users\\Rayner\\.chatcrystal\\data');
});

test('resolveDataDirForTest defaults to ~/.chatcrystal/data when installed outside a workspace', () => {
  const dataDir = resolveDataDirForTest({
    packageRoot: 'C:/Users/Rayner/AppData/Roaming/npm/node_modules/chatcrystal',
    workspaceRoot: null,
    homeDir: 'C:/Users/Rayner',
  });

  assert.equal(dataDir, 'C:\\Users\\Rayner\\.chatcrystal\\data');
});
