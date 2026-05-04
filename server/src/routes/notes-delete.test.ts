import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { noteRoutes } from './notes.js';

async function createApp() {
  const app = Fastify();
  await app.register(noteRoutes);
  return app;
}

test('DELETE /api/notes/:id returns 400 when review reason is missing', async () => {
  const app = await createApp();

  const response = await app.inject({
    method: 'DELETE',
    url: '/api/notes/10',
    payload: { source: 'cli' },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /reason/i);
  await app.close();
});

test('DELETE /api/notes/:id returns 400 when note id is invalid', async () => {
  const app = await createApp();

  const response = await app.inject({
    method: 'DELETE',
    url: '/api/notes/not-a-number',
    payload: { reason: 'duplicate', source: 'cli' },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /note id/i);
  await app.close();
});

test('DELETE /api/notes/:id rejects non-decimal positive integer ids', async () => {
  const app = await createApp();

  for (const id of ['1e2', '0x10', '10.0']) {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/notes/${id}`,
      payload: { reason: 'other', source: 'cli' },
    });

    assert.equal(response.statusCode, 400, `${id} should be rejected`);
    assert.match(response.json().error, /note id/i);
  }

  await app.close();
});

test('DELETE /api/notes/:id maps invalid review input to 400', async () => {
  const app = await createApp();

  const response = await app.inject({
    method: 'DELETE',
    url: '/api/notes/10',
    payload: { reason: 'invalid-reason', source: 'cli' },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /reason/i);
  await app.close();
});
