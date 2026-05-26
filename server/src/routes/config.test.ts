import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chatcrystal-config-route-test-'));

const { updateConfig } = await import('../config.js');
const { configRoutes } = await import('./config.js');

test('config test uses an OpenAI-compatible max_output_tokens value accepted by NewAPI', async () => {
  const upstream = Fastify();
  let capturedMaxOutputTokens: unknown;

  upstream.post('/v1/responses', async (req, reply) => {
    const body = req.body as { max_output_tokens?: number; model?: string };
    capturedMaxOutputTokens = body.max_output_tokens;

    if (
      typeof body.max_output_tokens !== 'number' ||
      body.max_output_tokens < 16
    ) {
      reply.status(400);
      return {
        error: {
          message: `Invalid 'max_output_tokens': integer below minimum value. Expected a value >= 16, but got ${body.max_output_tokens} instead.`,
          type: 'invalid_request_error',
          param: 'max_output_tokens',
          code: 'integer_below_minimum',
        },
      };
    }

    return {
      id: 'resp_test',
      created_at: 1_700_000_000,
      model: body.model ?? 'gpt-5.4',
      output: [
        {
          type: 'message',
          id: 'msg_test',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'OK', annotations: [] }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  });

  upstream.post('/v1/embeddings', async () => ({
    data: [{ embedding: [0.1, 0.2, 0.3] }],
    usage: { prompt_tokens: 1 },
  }));

  await upstream.listen({ host: '127.0.0.1', port: 0 });
  const address = upstream.server.address() as AddressInfo;
  const baseURL = `http://127.0.0.1:${address.port}/v1`;

  updateConfig({
    llm: {
      provider: 'custom',
      baseURL,
      apiKey: 'test-api-key',
      model: 'gpt-5.4',
    },
    embedding: {
      provider: 'custom',
      baseURL,
      apiKey: 'test-api-key',
      model: 'text-embedding-ada-002',
    },
  });

  const app = Fastify();
  await app.register(configRoutes);

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/config/test',
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.llm.connected, true, body.data.llm.error);
    assert.equal(body.data.llm.response, 'OK');
    assert.equal(
      body.data.embedding.connected,
      true,
      body.data.embedding.error,
    );
    assert.equal(body.data.connected, true);
    assert.equal(typeof capturedMaxOutputTokens, 'number');
    assert.ok(capturedMaxOutputTokens >= 16);
  } finally {
    await app.close();
    await upstream.close();
  }
});
