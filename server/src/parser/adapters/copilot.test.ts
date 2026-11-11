import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const fixtureRoot = mkdtempSync(join(tmpdir(), 'chatcrystal-copilot-wsl-'));
const windowsUser = join(fixtureRoot, 'windows', 'Code', 'User');
const wslHome = join(fixtureRoot, 'wsl-home');
const wslUser = join(wslHome, '.vscode-server', 'data', 'User');

process.env.COPILOT_DATA_DIR = windowsUser;
// Keep the real machine's WSL data out of the default test cases.
process.env.CHATCRYSTAL_WSL = '0';

const { copilotAdapter } = await import('./copilot.js');
const { setWslHomesForTesting } = await import('../wsl.js');

function copilotSession(options: {
  sessionId: string;
  requestId: string;
  userText: string;
  assistantText: string;
  timestamp: number;
}): string {
  return JSON.stringify({
    kind: 0,
    v: {
      version: 3,
      sessionId: options.sessionId,
      creationDate: options.timestamp,
      requests: [
        {
          requestId: options.requestId,
          timestamp: options.timestamp,
          message: { text: options.userText },
          response: [{ kind: 'text', value: options.assistantText }],
        },
      ],
    },
  });
}

function writeWorkspaceSession(
  userDir: string,
  workspaceHash: string,
  folder: string,
  sessionId: string,
  options: { requestId: string; userText: string; assistantText: string },
): string {
  const workspaceDir = join(userDir, 'workspaceStorage', workspaceHash);
  const chatDir = join(workspaceDir, 'chatSessions');
  mkdirSync(chatDir, { recursive: true });
  writeFileSync(
    join(workspaceDir, 'workspace.json'),
    JSON.stringify({ folder: `file:///${folder}` }),
    'utf-8',
  );
  const filePath = join(chatDir, `${sessionId}.jsonl`);
  writeFileSync(
    filePath,
    `${copilotSession({
      sessionId,
      requestId: options.requestId,
      userText: options.userText,
      assistantText: options.assistantText,
      timestamp: 1790000000000,
    })}\n{"kind":1,"k":["responderUsername"],"v":"GitHub Copilot"}\n`,
    'utf-8',
  );
  return filePath;
}

test.after(() => {
  setWslHomesForTesting(null);
  rmSync(fixtureRoot, { recursive: true, force: true });
});

test('detect and scan find the local VS Code Copilot sessions', async () => {
  writeWorkspaceSession(windowsUser, 'hash-local', 'C:/Users/me/code/app', 'local-session', {
    requestId: 'req-local',
    userText: 'local question',
    assistantText: 'local answer',
  });

  const info = await copilotAdapter.detect();
  assert.ok(info);
  assert.equal(info.conversationCount, 1);
  assert.equal(info.dataDir, windowsUser);

  const metas = await copilotAdapter.scan();
  assert.equal(metas.length, 1);
  assert.equal(metas[0].id, 'local-session');
  assert.equal(metas[0].rootDir, windowsUser);
});

test('parse keeps the request/response pair', async () => {
  const metas = await copilotAdapter.scan();
  const parsed = await copilotAdapter.parse(metas[0]);
  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.messages[0].content, 'local question');
  assert.equal(parsed.messages[1].content, 'local answer');
  assert.equal(parsed.projectName, 'app');
});

test('VS Code Remote sessions inside WSL are imported too', async () => {
  writeWorkspaceSession(wslUser, 'hash-wsl', 'home/me/code/wsl-app', 'wsl-session', {
    requestId: 'req-wsl',
    userText: 'wsl question',
    assistantText: 'wsl answer',
  });
  setWslHomesForTesting([wslHome]);
  try {
    const info = await copilotAdapter.detect();
    assert.ok(info);
    assert.equal(info.conversationCount, 2);

    const metas = await copilotAdapter.scan();
    assert.equal(metas.length, 2);
    const wsl = metas.find((meta) => meta.id === 'wsl-session');
    assert.ok(wsl);
    assert.match(wsl.filePath, /wsl-home/);
    assert.equal(wsl.rootDir, wslUser);

    const parsed = await copilotAdapter.parse(wsl);
    assert.equal(parsed.messages[0].content, 'wsl question');
    assert.equal(parsed.messages[1].content, 'wsl answer');
  } finally {
    setWslHomesForTesting([]);
  }
});

test('empty WSL roots leave local-only results', async () => {
  setWslHomesForTesting([]);
  const info = await copilotAdapter.detect();
  assert.ok(info);
  assert.equal(info.conversationCount, 1);
});
