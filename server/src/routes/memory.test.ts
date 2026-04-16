import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { memoryRoutes } from './memory.js';

test('memory recall returns 400 for validation failures', async () => {
  const app = Fastify();
  await app.register(memoryRoutes);

  const response = await app.inject({
    method: 'POST',
    url: '/api/memory/recall',
    payload: {
      mode: 'task',
      task: {
        task_kind: 'debug',
      },
    },
  });

  assert.equal(response.statusCode, 400);
  await app.close();
});

test('memory recall returns 500 for internal failures after validation succeeds', async () => {
  const app = Fastify();
  await app.register(memoryRoutes);

  const response = await app.inject({
    method: 'POST',
    url: '/api/memory/recall',
    payload: {
      mode: 'task',
      task: {
        goal: 'Fix flaky timeout',
        task_kind: 'debug',
      },
    },
  });

  assert.equal(response.statusCode, 500);
  await app.close();
});

test('memory writeback returns 500 for internal failures after validation succeeds', async () => {
  const app = Fastify();
  await app.register(memoryRoutes);

  const response = await app.inject({
    method: 'POST',
    url: '/api/memory/writeback',
    payload: {
      mode: 'manual',
      task: {
        goal: 'Capture a reusable fix',
        task_kind: 'debug',
      },
      memory: {
        summary: 'Await readiness before requests.',
        outcome_type: 'fix',
      },
    },
  });

  assert.equal(response.statusCode, 500);
  await app.close();
});
