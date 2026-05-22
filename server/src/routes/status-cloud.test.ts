import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chatcrystal-status-cloud-test-'));
process.env.CHATCRYSTAL_CLOUD_MODE = 'true';

const db = await import('../db/index.js');
const { statusRoutes } = await import('./status.js');
const { registerAdapter } = await import('../parser/index.js');

test('status includes cloud mode and provider warnings for authenticated callers', async () => {
  await db.initDatabase();
  const app = Fastify();
  await app.register(statusRoutes);

  const response = await app.inject({ method: 'GET', url: '/api/status' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.cloudMode, true);
  assert.ok(Array.isArray(response.json().data.providerWarnings));
  await app.close();
  db.closeDatabase();
});

test('cloud config response does not detect local source adapters', async () => {
  await db.initDatabase();
  registerAdapter({
    name: 'cloud-detect-should-not-run',
    displayName: 'Cloud detect should not run',
    detect: async () => {
      throw new Error('cloud mode must not detect local source adapters');
    },
    scan: async () => [],
    parse: async () => {
      throw new Error('not used');
    },
  });
  const app = Fastify();
  await app.register(statusRoutes);

  const response = await app.inject({ method: 'GET', url: '/api/config' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data.sources, []);
  assert.equal(response.json().data.claudeProjectsDir, '');
  await app.close();
  db.closeDatabase();
});
