import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const fixtureRoot = mkdtempSync(join(tmpdir(), 'chatcrystal-claude-wsl-'));
const windowsProjects = join(fixtureRoot, 'windows', '.claude', 'projects');
const wslHome = join(fixtureRoot, 'wsl-home');
const wslProjects = join(wslHome, '.claude', 'projects');

process.env.CLAUDE_PROJECTS_DIR = windowsProjects;
process.env.CHATCRYSTAL_WSL_HOMES = wslHome;

const { claudeCodeAdapter } = await import('./claude-code.js');
const { setWslHomesForTesting } = await import('../wsl.js');

function claudeLine(options: {
  uuid: string;
  parentUuid: string | null;
  type: 'user' | 'assistant';
  text: string;
  cwd: string;
  timestamp: string;
}): string {
  return JSON.stringify({
    uuid: options.uuid,
    parentUuid: options.parentUuid,
    type: options.type,
    sessionId: 'session-1',
    cwd: options.cwd,
    timestamp: options.timestamp,
    message: {
      role: options.type,
      content: options.text,
    },
  });
}

function writeSession(
  projectsDir: string,
  projectFolder: string,
  sessionId: string,
  cwd: string,
  userText: string,
  assistantText: string,
): string {
  const projectPath = join(projectsDir, projectFolder);
  mkdirSync(projectPath, { recursive: true });
  const filePath = join(projectPath, `${sessionId}.jsonl`);
  const lines = [
    claudeLine({
      uuid: 'u1',
      parentUuid: null,
      type: 'user',
      text: userText,
      cwd,
      timestamp: '2026-11-10T10:00:00.000Z',
    }),
    claudeLine({
      uuid: 'a1',
      parentUuid: 'u1',
      type: 'assistant',
      text: assistantText,
      cwd,
      timestamp: '2026-11-10T10:00:01.000Z',
    }),
  ];
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8');
  return filePath;
}

test.after(() => {
  setWslHomesForTesting(null);
  rmSync(fixtureRoot, { recursive: true, force: true });
});

test('detect counts local and WSL conversations', async () => {
  writeSession(
    windowsProjects,
    'C--Users-me-code-app',
    'local-session',
    'C:\\Users\\me\\code\\app',
    'local question',
    'local answer',
  );
  writeSession(
    wslProjects,
    '-home-me-code-app',
    'wsl-session',
    '/home/me/code/app',
    'wsl question',
    'wsl answer',
  );

  const info = await claudeCodeAdapter.detect();
  assert.ok(info);
  assert.equal(info.name, 'claude-code');
  assert.equal(info.dataDir, windowsProjects);
  // One conversation is stored locally and one inside the WSL distro home.
  assert.equal(info.conversationCount, 2);
});

test('scan reports both roots and marks WSL conversations with rootDir', async () => {
  const metas = await claudeCodeAdapter.scan();
  assert.equal(metas.length, 2);

  const local = metas.find((meta) => meta.id === 'local-session');
  const wsl = metas.find((meta) => meta.id === 'wsl-session');
  assert.ok(local);
  assert.ok(wsl);
  assert.equal(local.rootDir, windowsProjects);
  assert.equal(wsl.rootDir, wslProjects);
  assert.match(wsl.filePath, /wsl-home/);
});

test('parse reads a WSL conversation like a local one', async () => {
  const metas = await claudeCodeAdapter.scan();
  const wsl = metas.find((meta) => meta.id === 'wsl-session');
  assert.ok(wsl);

  const parsed = await claudeCodeAdapter.parse(wsl);
  assert.equal(parsed.id, 'wsl-session');
  assert.equal(parsed.cwd, '/home/me/code/app');
  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.messages[0].type, 'user');
  assert.equal(parsed.messages[0].content, 'wsl question');
  assert.equal(parsed.messages[1].content, 'wsl answer');
});

test('scan stops adding WSL roots when discovery is disabled', async () => {
  setWslHomesForTesting([]);
  try {
    const info = await claudeCodeAdapter.detect();
    assert.ok(info);
    assert.equal(info.conversationCount, 1);
    const metas = await claudeCodeAdapter.scan();
    assert.deepEqual(metas.map((meta) => meta.id), ['local-session']);
  } finally {
    setWslHomesForTesting([wslHome]);
  }
});
