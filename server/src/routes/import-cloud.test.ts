import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chatcrystal-import-cloud-test-'));
process.env.CHATCRYSTAL_CLOUD_MODE = 'true';
process.env.CHATCRYSTAL_API_TOKEN = 'cloud-import-test-token';

const { importRoutes } = await import('./import.js');

test('cloud mode rejects server-side import scan without scanning container paths', async () => {
  const app = Fastify();
  await app.register(importRoutes);

  const response = await app.inject({ method: 'POST', url: '/api/import/scan' });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /local-only/i);
  await app.close();
});

test('cloud mode rejects import scan stream as local-only', async () => {
  const app = Fastify();
  await app.register(importRoutes);

  const response = await app.inject({ method: 'GET', url: '/api/import/scan/stream' });

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /local-only/i);
  await app.close();
});
