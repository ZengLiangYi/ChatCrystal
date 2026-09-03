import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOpenAICompatibleModelUrlCandidates,
  discoverProviderModels,
  ModelDiscoveryError,
} from './modelDiscovery.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('buildOpenAICompatibleModelUrlCandidates derives model endpoints from OpenAI-style bases', () => {
  assert.deepEqual(
    buildOpenAICompatibleModelUrlCandidates('https://api.example.com'),
    ['https://api.example.com/v1/models'],
  );
  assert.deepEqual(
    buildOpenAICompatibleModelUrlCandidates('https://api.example.com/v1'),
    ['https://api.example.com/v1/models'],
  );
  assert.deepEqual(
    buildOpenAICompatibleModelUrlCandidates('https://open.bigmodel.cn/api/coding/paas/v4'),
    [
      'https://open.bigmodel.cn/api/coding/paas/v4/models',
      'https://open.bigmodel.cn/api/coding/paas/v4/v1/models',
    ],
  );
  assert.deepEqual(
    buildOpenAICompatibleModelUrlCandidates('https://api.deepseek.com/anthropic'),
    [
      'https://api.deepseek.com/anthropic/v1/models',
      'https://api.deepseek.com/v1/models',
      'https://api.deepseek.com/models',
    ],
  );
});

test('discoverProviderModels parses Ollama local model names', async () => {
  const calls: string[] = [];
  const models = await discoverProviderModels(
    {
      target: 'llm',
      provider: 'ollama',
      baseURL: 'http://localhost:11434',
      apiKey: '',
    },
    {
      fetch: async (url) => {
        calls.push(String(url));
        return jsonResponse({ models: [{ name: 'qwen2.5:7b' }, { name: 'nomic-embed-text' }] });
      },
    },
  );

  assert.deepEqual(calls, ['http://localhost:11434/api/tags']);
  assert.deepEqual(models, [
    { id: 'nomic-embed-text', ownedBy: null },
    { id: 'qwen2.5:7b', ownedBy: null },
  ]);
});

test('discoverProviderModels parses OpenAI-compatible model responses and skips missing candidates', async () => {
  const calls: string[] = [];
  const models = await discoverProviderModels(
    {
      target: 'llm',
      provider: 'custom',
      baseURL: 'https://api.deepseek.com/anthropic',
      apiKey: 'test-key',
    },
    {
      fetch: async (url, init) => {
        calls.push(`${String(url)}|${new Headers(init?.headers).get('authorization')}`);
        if (String(url).endsWith('/anthropic/v1/models')) {
          return new Response('not found', { status: 404 });
        }
        return jsonResponse({
          data: [
            { id: 'deepseek-chat', owned_by: 'deepseek' },
            { id: 'deepseek-reasoner' },
          ],
        });
      },
    },
  );

  assert.deepEqual(calls, [
    'https://api.deepseek.com/anthropic/v1/models|Bearer test-key',
    'https://api.deepseek.com/v1/models|Bearer test-key',
  ]);
  assert.deepEqual(models, [
    { id: 'deepseek-chat', ownedBy: 'deepseek' },
    { id: 'deepseek-reasoner', ownedBy: null },
  ]);
});

test('discoverProviderModels discovers OrcaRouter models from its fixed endpoint', async () => {
  const calls: string[] = [];
  const models = await discoverProviderModels(
    {
      target: 'llm',
      provider: 'orcarouter',
      baseURL: 'https://ignored.example.com/v1',
      apiKey: 'sk-orca-test',
    },
    {
      fetch: async (url, init) => {
        calls.push(`${String(url)}|${new Headers(init?.headers).get('authorization')}`);
        return jsonResponse({
          data: [
            { id: 'orcarouter/auto', owned_by: 'orcarouter' },
            { id: 'openai/gpt-4o-mini' },
          ],
        });
      },
    },
  );

  assert.deepEqual(calls, [
    'https://api.orcarouter.ai/v1/models|Bearer sk-orca-test',
  ]);
  assert.deepEqual(models, [
    { id: 'openai/gpt-4o-mini', ownedBy: null },
    { id: 'orcarouter/auto', ownedBy: 'orcarouter' },
  ]);
});

test('discoverProviderModels parses Anthropic and Google model responses', async () => {
  const anthropic = await discoverProviderModels(
    {
      target: 'llm',
      provider: 'anthropic',
      apiKey: 'anthropic-key',
    },
    {
      fetch: async (_url, init) => {
        assert.equal(new Headers(init?.headers).get('x-api-key'), 'anthropic-key');
        return jsonResponse({
          data: [
            { id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet' },
            { id: 'claude-haiku-4-5' },
          ],
        });
      },
    },
  );
  assert.deepEqual(anthropic, [
    { id: 'claude-haiku-4-5', ownedBy: 'anthropic' },
    { id: 'claude-sonnet-4-5', ownedBy: 'anthropic' },
  ]);

  const googleCalls: string[] = [];
  const google = await discoverProviderModels(
    {
      target: 'embedding',
      provider: 'google',
      apiKey: 'google-key',
    },
    {
      fetch: async (url) => {
        googleCalls.push(String(url));
        return jsonResponse({
          models: [
            { name: 'models/gemini-2.5-pro' },
            { name: 'models/text-embedding-004' },
          ],
        });
      },
    },
  );
  assert.equal(
    googleCalls[0],
    'https://generativelanguage.googleapis.com/v1beta/models?key=google-key',
  );
  assert.deepEqual(google, [
    { id: 'gemini-2.5-pro', ownedBy: 'google' },
    { id: 'text-embedding-004', ownedBy: 'google' },
  ]);
});

test('discoverProviderModels returns structured errors for unsupported providers and missing config', async () => {
  await assert.rejects(
    () => discoverProviderModels({ target: 'llm', provider: 'azure', apiKey: 'key' }),
    (error) =>
      error instanceof ModelDiscoveryError &&
      error.code === 'provider_unsupported',
  );

  await assert.rejects(
    () => discoverProviderModels({ target: 'llm', provider: 'openai', apiKey: '' }),
    (error) =>
      error instanceof ModelDiscoveryError &&
      error.code === 'missing_api_key',
  );

  await assert.rejects(
    () => discoverProviderModels({ target: 'llm', provider: 'orcarouter', apiKey: '' }),
    (error) =>
      error instanceof ModelDiscoveryError &&
      error.code === 'missing_api_key',
  );

  await assert.rejects(
    () => discoverProviderModels({ target: 'llm', provider: 'custom', baseURL: '', apiKey: 'key' }),
    (error) =>
      error instanceof ModelDiscoveryError &&
      error.code === 'missing_base_url',
  );
});

test('discoverProviderModels maps auth, endpoint, timeout, and parse failures', async () => {
  await assert.rejects(
    () =>
      discoverProviderModels(
        { target: 'llm', provider: 'openai', apiKey: 'bad-key' },
        { fetch: async () => new Response('denied', { status: 401 }) },
      ),
    (error) => error instanceof ModelDiscoveryError && error.code === 'auth_failed',
  );

  await assert.rejects(
    () =>
      discoverProviderModels(
        { target: 'llm', provider: 'custom', baseURL: 'https://api.example.com', apiKey: 'key' },
        { fetch: async () => new Response('missing', { status: 404 }) },
      ),
    (error) => error instanceof ModelDiscoveryError && error.code === 'endpoint_not_found',
  );

  await assert.rejects(
    () =>
      discoverProviderModels(
        { target: 'llm', provider: 'openai', apiKey: 'key' },
        {
          fetch: async () => {
            throw new DOMException('The operation timed out', 'TimeoutError');
          },
        },
      ),
    (error) => error instanceof ModelDiscoveryError && error.code === 'timeout',
  );

  await assert.rejects(
    () =>
      discoverProviderModels(
        { target: 'llm', provider: 'openai', apiKey: 'key' },
        { fetch: async () => new Response('{', { status: 200 }) },
      ),
    (error) => error instanceof ModelDiscoveryError && error.code === 'parse_failed',
  );
});
