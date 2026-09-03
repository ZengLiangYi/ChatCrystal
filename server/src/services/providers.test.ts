import assert from 'node:assert/strict';
import test from 'node:test';
import { generateText } from 'ai';
import { listProviders } from './providers.js';

test('listProviders registers OrcaRouter as a first-class LLM provider', () => {
  const provider = listProviders().find((entry) => entry.name === 'orcarouter');

  assert.ok(provider);
  assert.equal(provider.displayName, 'OrcaRouter');
  assert.equal(provider.requiresApiKey, true);
  assert.equal(provider.requiresBaseURL, false);
  assert.equal(provider.supportsModelDiscovery, true);
  assert.equal(provider.supportsEmbedding, false);
  assert.equal(provider.createEmbeddingModel, undefined);

  const model = provider.createLanguageModel({
    apiKey: 'sk-orca-test',
    baseURL: 'https://ignored.example.com/v1',
    model: 'orcarouter/auto',
  });
  assert.match(model.provider, /^orcarouter\./);
  assert.equal(model.modelId, 'orcarouter/auto');
});

test('OrcaRouter generation uses its fixed OpenAI-compatible endpoint', async () => {
  const provider = listProviders().find((entry) => entry.name === 'orcarouter');
  assert.ok(provider);

  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  let authorization: string | null = null;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    authorization = new Headers(init?.headers).get('authorization');
    return new Response(JSON.stringify({
      id: 'resp_test',
      created_at: 1_700_000_000,
      model: 'orcarouter/auto',
      output: [{
        type: 'message',
        id: 'msg_test',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'OK', annotations: [] }],
      }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const model = provider.createLanguageModel({
      apiKey: 'sk-orca-test',
      baseURL: 'https://ignored.example.com/v1',
      model: 'orcarouter/auto',
    });
    const result = await generateText({
      model,
      prompt: 'Reply with exactly: OK',
      maxOutputTokens: 16,
    });

    assert.equal(requestUrl, 'https://api.orcarouter.ai/v1/responses');
    assert.equal(authorization, 'Bearer sk-orca-test');
    assert.equal(result.text, 'OK');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
