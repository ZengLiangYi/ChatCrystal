import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getProviderWarningsForTest,
  isCloudModeForEnv,
  isLocalBaseUrl,
  isPublicApiPath,
} from './cloud.js';

test('isCloudModeForEnv enables cloud behavior only for explicit cloud mode or token', () => {
  assert.equal(isCloudModeForEnv({}), false);
  assert.equal(isCloudModeForEnv({ CHATCRYSTAL_CLOUD_MODE: 'false' }), false);
  assert.equal(isCloudModeForEnv({ CHATCRYSTAL_CLOUD_MODE: 'true' }), true);
  assert.equal(isCloudModeForEnv({ CHATCRYSTAL_API_TOKEN: 'secret-token' }), true);
});

test('isLocalBaseUrl detects local URLs only', () => {
  assert.equal(isLocalBaseUrl('http://localhost:3721'), true);
  assert.equal(isLocalBaseUrl('http://127.0.0.1:3721'), true);
  assert.equal(isLocalBaseUrl('http://[::1]:3721'), true);
  assert.equal(isLocalBaseUrl('http://0.0.0.0:3721'), false);
  assert.equal(isLocalBaseUrl('https://chatcrystal.example.com'), false);
  assert.equal(isLocalBaseUrl('http://192.168.1.20:3721'), false);
});

test('isPublicApiPath keeps only setup, auth verify, and health public', () => {
  assert.equal(isPublicApiPath('/api/health'), true);
  assert.equal(isPublicApiPath('/api/setup/status'), true);
  assert.equal(isPublicApiPath('/api/setup/complete'), true);
  assert.equal(isPublicApiPath('/api/auth/verify'), true);
  assert.equal(isPublicApiPath('/api/status'), false);
  assert.equal(isPublicApiPath('/api/import/scan/stream'), false);
});

test('getProviderWarningsForTest warns for container-local Ollama defaults', () => {
  const warnings = getProviderWarningsForTest({
    cloudMode: true,
    llm: { provider: 'ollama', baseURL: 'http://localhost:11434', model: 'qwen2.5:7b' },
    embedding: { provider: 'ollama', baseURL: 'http://127.0.0.1:11434', model: 'nomic-embed-text' },
  });

  assert.deepEqual(warnings, [
    'LLM provider points to localhost from inside the container. Use host.docker.internal, a remote HTTPS API, or a trusted network Ollama URL.',
    'Embedding provider points to localhost from inside the container. Use host.docker.internal, a remote HTTPS API, or a trusted network Ollama URL.',
  ]);
});
