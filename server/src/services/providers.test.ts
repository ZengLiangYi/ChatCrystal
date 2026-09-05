import assert from 'node:assert/strict';
import test from 'node:test';
import { embed, generateText, Output } from 'ai';
import { z } from 'zod';
import { listProviders } from './providers.js';

test('provider factories expose AI SDK 7 language and embedding models', () => {
  const expected = {
    ollama: { language: 'ollama.chat', embedding: 'ollama.embedding' },
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

test('Ollama structured outputs use its broadly compatible chat endpoint', async () => {
  const provider = listProviders().find((entry) => entry.name === 'ollama');
  assert.ok(provider);

  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: 'chatcmpl_test',
      created: 1_700_000_000,
      model: 'qwen3',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: JSON.stringify({ title: 'Local' }) },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const model = provider.createLanguageModel({
      baseURL: 'http://localhost:11434/',
      model: 'qwen3',
    });
    const result = await generateText({
      model,
      output: Output.object({ schema: z.object({ title: z.string() }) }),
      prompt: 'Return an object.',
    });

    assert.equal(requestUrl, 'http://localhost:11434/v1/chat/completions');
    assert.equal((requestBody.response_format as { type?: string })?.type, 'json_schema');
    assert.deepEqual(result.output, { title: 'Local' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI SDK 7 structured outputs use the Responses API contract', async () => {
  const provider = listProviders().find((entry) => entry.name === 'custom');
  assert.ok(provider);

  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url: String(input), body });
    const text = requests.length === 1
      ? JSON.stringify({ title: 'Reviewed' })
      : JSON.stringify({ elements: [{ noteId: 7 }] });

    return new Response(JSON.stringify({
      id: `resp_${requests.length}`,
      created_at: 1_700_000_000,
      model: 'test-model',
      output: [{
        type: 'message',
        id: `msg_${requests.length}`,
        role: 'assistant',
        content: [{ type: 'output_text', text, annotations: [] }],
      }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const model = provider.createLanguageModel({
      apiKey: 'test-api-key',
      baseURL: 'https://example.test/v1',
      model: 'test-model',
    });
    const objectResult = await generateText({
      model,
      output: Output.object({ schema: z.object({ title: z.string() }) }),
      prompt: 'Return an object.',
    });
    const arrayResult = await generateText({
      model,
      output: Output.array({ element: z.object({ noteId: z.number() }) }),
      prompt: 'Return an array.',
    });

    assert.deepEqual(objectResult.output, { title: 'Reviewed' });
    assert.deepEqual(arrayResult.output, [{ noteId: 7 }]);
    assert.deepEqual(requests.map(({ url }) => url), [
      'https://example.test/v1/responses',
      'https://example.test/v1/responses',
    ]);
    for (const { body } of requests) {
      assert.equal((body.text as { format?: { type?: string } })?.format?.type, 'json_schema');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI SDK 7 embeddingModel uses the embeddings endpoint contract', async () => {
  const provider = listProviders().find((entry) => entry.name === 'custom');
  assert.ok(provider?.createEmbeddingModel);

  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      object: 'list',
      data: [{ object: 'embedding', index: 0, embedding: [0.25, 0.75] }],
      model: 'test-embedding-model',
      usage: { prompt_tokens: 1, total_tokens: 1 },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const model = provider.createEmbeddingModel({
      apiKey: 'test-api-key',
      baseURL: 'https://example.test/v1',
      model: 'test-embedding-model',
    });
    const result = await embed({ model, value: 'dependency review' });

    assert.equal(requestUrl, 'https://example.test/v1/embeddings');
    assert.deepEqual(requestBody.input, ['dependency review']);
    assert.equal(requestBody.model, 'test-embedding-model');
    assert.deepEqual(result.embedding, [0.25, 0.75]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
