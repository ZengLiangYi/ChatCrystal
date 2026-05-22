import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chatcrystal-setup-route-test-'));
process.env.CHATCRYSTAL_CLOUD_MODE = 'true';
delete process.env.CHATCRYSTAL_API_TOKEN;

const { authRoutes, registerCloudAuthHook } = await import('./setup.js');
const { healthRoutes } = await import('./health.js');
const auth = await import('../services/auth.js');

test('health is public and setup status reports setup required', async () => {
  await auth.resetStoredAuthForLocalAdmin();
  const app = Fastify();
  await app.register(healthRoutes);
  await app.register(authRoutes);
  registerCloudAuthHook(app);

  const health = await app.inject({ method: 'GET', url: '/api/health' });
  const status = await app.inject({ method: 'GET', url: '/api/setup/status' });

  assert.equal(health.statusCode, 200);
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().data.setupRequired, true);
  await app.close();
});

test('cloud auth hook blocks private APIs during setup mode', async () => {
  await auth.resetStoredAuthForLocalAdmin();
  const app = Fastify();
  await app.register(authRoutes);
  registerCloudAuthHook(app);
  app.get('/api/private-test', async () => ({ success: true }));

  const response = await app.inject({ method: 'GET', url: '/api/private-test' });

  assert.equal(response.statusCode, 403);
  assert.match(response.json().error, /setup required/i);
  await app.close();
});

test('setup completion stores token and protected routes require bearer token', async () => {
  await auth.resetStoredAuthForLocalAdmin();
  const setupCode = auth.getOrCreateSetupCode();
  const app = Fastify();
  await app.register(authRoutes);
  registerCloudAuthHook(app);
  app.get('/api/private-test', async () => ({ success: true, data: { ok: true } }));

  const complete = await app.inject({
    method: 'POST',
    url: '/api/setup/complete',
    payload: { setupCode, token: 'route-secret-token' },
  });
  const unauthorized = await app.inject({ method: 'GET', url: '/api/private-test' });
  const authorized = await app.inject({
    method: 'GET',
    url: '/api/private-test',
    headers: { authorization: 'Bearer route-secret-token' },
  });

  assert.equal(complete.statusCode, 200);
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(authorized.statusCode, 200);
  await app.close();
});

test('setup complete rejects oversized and overlong public bodies without consuming setup code', async () => {
  await auth.resetStoredAuthForLocalAdmin();
  const setupCode = auth.getOrCreateSetupCode();
  const app = Fastify({ bodyLimit: 25 * 1024 * 1024 });
  await app.register(authRoutes);

  const oversized = await app.inject({
    method: 'POST',
    url: '/api/setup/complete',
    payload: { setupCode, token: 'x'.repeat(10 * 1024) },
  });
  const overlong = await app.inject({
    method: 'POST',
    url: '/api/setup/complete',
    payload: { setupCode, token: 'x'.repeat(auth.TOKEN_MAX_LENGTH + 1) },
  });

  assert.equal(oversized.statusCode, 413);
  assert.equal(overlong.statusCode, 400);
  assert.equal(await auth.completeSetup(setupCode, 'valid-route-secret'), true);
  await app.close();
});

test('token rotation rejects oversized and overlong public bodies before verification', async () => {
  await auth.resetStoredAuthForLocalAdmin();
  await auth.setStoredToken('current-route-secret');
  const app = Fastify({ bodyLimit: 25 * 1024 * 1024 });
  await app.register(authRoutes);

  const oversized = await app.inject({
    method: 'POST',
    url: '/api/auth/rotate',
    payload: {
      currentToken: 'current-route-secret',
      nextToken: 'x'.repeat(10 * 1024),
    },
  });
  const overlong = await app.inject({
    method: 'POST',
    url: '/api/auth/rotate',
    payload: {
      currentToken: 'x'.repeat(auth.TOKEN_MAX_LENGTH + 1),
      nextToken: 'next-route-secret',
    },
  });

  assert.equal(oversized.statusCode, 413);
  assert.equal(overlong.statusCode, 400);
  assert.equal(await auth.verifyToken('current-route-secret'), true);
  await app.close();
});
