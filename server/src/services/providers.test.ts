import assert from 'node:assert/strict';
import test from 'node:test';
import { generateText } from 'ai';
import { listProviders } from './providers.js';

test('provider factories expose AI SDK 7 language and embedding models', () => {
  const expected = {
    ollama: { language: 'ollama.responses', embedding: 'ollama.embedding' },
    openai: { language: 'openai.responses', embedding: 'openai.embedding' },
    orcarouter: { language: 'orcarouter.responses', embedding: undefined },
    anthropic: { language: 'anthropic.messages', embedding: undefined },
    google: { language: 'google.generative-ai', embedding: 'google.generative-ai' },
    azure: { language: 'azure.responses', embedding: 'azure.embeddings' },
    custom: { language: 'custom.responses', embedding: 'custom.embedding' },
  } as const;

  const providers = listProviders();
  assert.deepEqual(providers.map((provider) => provider.name), Object.keys(expected));

  for (const provider of providers) {
    const contract = expected[provider.name as keyof typeof expected];
    const config = {
      apiKey: 'test-api-key',
      baseURL: 'https://example.test/v1',
      model: 'test-model',
    };
    const languageModel = provider.createLanguageModel(config);
    const embeddingModel = provider.createEmbeddingModel?.(config);

    assert.equal(languageModel.provider, contract.language, `${provider.name} language provider`);
    assert.equal(languageModel.modelId, config.model, `${provider.name} language model id`);
    assert.equal(embeddingModel?.provider, contract.embedding, `${provider.name} embedding provider`);
    assert.equal(embeddingModel?.modelId, contract.embedding ? config.model : undefined);
    assert.equal(provider.supportsEmbedding, contract.embedding !== undefined);
  }
});

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
