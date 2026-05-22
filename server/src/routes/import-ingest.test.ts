import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chatcrystal-ingest-route-test-'));
process.env.CHATCRYSTAL_CLOUD_MODE = 'true';
process.env.CHATCRYSTAL_API_TOKEN = 'route-ingest-secret';

const [{ initDatabase }, { authRoutes, registerCloudAuthHook }, { importRoutes }, { buildRemoteImportItem }] = await Promise.all([
  import('../db/index.js'),
  import('./setup.js'),
  import('./import.js'),
  import('../services/importPayload.js'),
]);

await initDatabase();

function item() {
  return buildRemoteImportItem(
    'codex',
    {
      id: 'session-route',
      source: 'codex',
      filePath: 'C:/fixtures/session-route.jsonl',
      fileSize: 10,
      fileMtime: '2026-05-20T00:00:00Z',
      projectDir: 'C:/repo',
    },
    {
      id: 'session-route',
      slug: 'session-route',
      source: 'codex',
      projectDir: 'C:/repo',
      projectName: 'repo',
      cwd: 'C:/repo',
      gitBranch: 'main',
      firstMessageAt: '2026-05-20T00:00:00Z',
      lastMessageAt: '2026-05-20T00:01:00Z',
      messages: [
        {
          id: 'm1',
          parentUuid: null,
          type: 'user',
          role: 'user',
          content: 'hello',
          hasToolUse: false,
          hasCode: false,
          thinking: null,
          timestamp: '2026-05-20T00:00:00Z',
        },
        {
          id: 'm2',
          parentUuid: 'm1',
          type: 'assistant',
          role: 'assistant',
          content: 'world',
          hasToolUse: false,
          hasCode: false,
          thinking: null,
          timestamp: '2026-05-20T00:01:00Z',
        },
      ],
    },
  );
}

test('remote ingest route is authenticated and stores uploaded conversations', async () => {
  const app = Fastify();
  await app.register(authRoutes);
  registerCloudAuthHook(app);
  await app.register(importRoutes);

  const unauthorized = await app.inject({
    method: 'POST',
    url: '/api/import/ingest',
    payload: { version: 1, items: [item()] },
  });
  const authorized = await app.inject({
    method: 'POST',
    url: '/api/import/ingest',
    headers: { authorization: 'Bearer route-ingest-secret' },
    payload: { version: 1, items: [item()] },
  });

  assert.equal(unauthorized.statusCode, 401);
  assert.equal(authorized.statusCode, 200);
  assert.equal(authorized.json().data.imported, 1);
  await app.close();
});

test('remote ingest route rejects non-cloud servers', async () => {
  const previousMode = process.env.CHATCRYSTAL_CLOUD_MODE;
  const previousToken = process.env.CHATCRYSTAL_API_TOKEN;
  process.env.CHATCRYSTAL_CLOUD_MODE = 'false';
  delete process.env.CHATCRYSTAL_API_TOKEN;
  const app = Fastify();
  await app.register(importRoutes);

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/import/ingest',
      payload: { version: 1, items: [item()] },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /only available in cloud mode/i);
  } finally {
    if (previousMode === undefined) {
      delete process.env.CHATCRYSTAL_CLOUD_MODE;
    } else {
      process.env.CHATCRYSTAL_CLOUD_MODE = previousMode;
    }
    if (previousToken === undefined) {
      delete process.env.CHATCRYSTAL_API_TOKEN;
    } else {
      process.env.CHATCRYSTAL_API_TOKEN = previousToken;
    }
    await app.close();
  }
});
