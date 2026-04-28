import assert from 'node:assert/strict';
import { posix, win32 } from 'node:path';
import test from 'node:test';
import { resolveDataDirForTest } from './paths.js';

const pathCases = [
  {
    name: 'Windows',
    pathResolver: win32,
    absoluteDataDir: 'C:/data/chatcrystal',
    packageRoot: 'C:/repo/server',
    workspaceRoot: 'C:/repo',
    globalPackageRoot: 'C:/global/node_modules/chatcrystal',
    homeDir: 'C:/Users/Rayner',
  },
  {
    name: 'POSIX',
    pathResolver: posix,
    absoluteDataDir: '/data/chatcrystal',
    packageRoot: '/repo/server',
    workspaceRoot: '/repo',
    globalPackageRoot: '/global/node_modules/chatcrystal',
    homeDir: '/home/rayner',
  },
];

for (const pathCase of pathCases) {
  test(`resolveDataDirForTest uses absolute DATA_DIR verbatim on ${pathCase.name}`, () => {
    const dataDir = resolveDataDirForTest({
      envDataDir: pathCase.absoluteDataDir,
      packageRoot: pathCase.packageRoot,
      workspaceRoot: pathCase.workspaceRoot,
      homeDir: pathCase.homeDir,
      pathResolver: pathCase.pathResolver,
    });

    assert.equal(dataDir, pathCase.absoluteDataDir);
  });

  test(`resolveDataDirForTest resolves relative DATA_DIR against workspace root on ${pathCase.name}`, () => {
    const dataDir = resolveDataDirForTest({
      envDataDir: './data',
      packageRoot: pathCase.packageRoot,
      workspaceRoot: pathCase.workspaceRoot,
      homeDir: pathCase.homeDir,
      pathResolver: pathCase.pathResolver,
    });

    assert.equal(dataDir, pathCase.pathResolver.resolve(pathCase.workspaceRoot, 'data'));
  });

  test(`resolveDataDirForTest falls back to package root when no workspace root exists on ${pathCase.name}`, () => {
    const dataDir = resolveDataDirForTest({
      envDataDir: './data',
      packageRoot: pathCase.globalPackageRoot,
      workspaceRoot: null,
      homeDir: pathCase.homeDir,
      pathResolver: pathCase.pathResolver,
    });

    assert.equal(dataDir, pathCase.pathResolver.resolve(pathCase.globalPackageRoot, 'data'));
  });

  test(`resolveDataDirForTest defaults to ~/.chatcrystal/data when DATA_DIR is unset in a repo checkout on ${pathCase.name}`, () => {
    const dataDir = resolveDataDirForTest({
      packageRoot: pathCase.packageRoot,
      workspaceRoot: pathCase.workspaceRoot,
      homeDir: pathCase.homeDir,
      pathResolver: pathCase.pathResolver,
    });

    assert.equal(dataDir, pathCase.pathResolver.resolve(pathCase.homeDir, '.chatcrystal', 'data'));
  });

  test(`resolveDataDirForTest defaults to ~/.chatcrystal/data when installed outside a workspace on ${pathCase.name}`, () => {
    const dataDir = resolveDataDirForTest({
      packageRoot: pathCase.globalPackageRoot,
      workspaceRoot: null,
      homeDir: pathCase.homeDir,
      pathResolver: pathCase.pathResolver,
    });

    assert.equal(dataDir, pathCase.pathResolver.resolve(pathCase.homeDir, '.chatcrystal', 'data'));
  });
}
