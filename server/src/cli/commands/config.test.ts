import assert from 'node:assert/strict';
import test from 'node:test';
import { formatConfigSetSuccess, isSensitiveConfigKey } from './config.js';

test('config set output redacts secret-like values', () => {
  assert.equal(isSensitiveConfigKey('llm.apiKey'), true);
  assert.equal(isSensitiveConfigKey('embedding.api_key'), true);
  assert.equal(isSensitiveConfigKey('llm.model'), false);
  assert.equal(formatConfigSetSuccess('llm.apiKey', 'sk-secret-value'), 'Updated llm.apiKey = (set)');
  assert.equal(formatConfigSetSuccess('embedding.apiKey', '   '), 'Updated embedding.apiKey = (cleared)');
  assert.equal(formatConfigSetSuccess('llm.model', 'gpt-4o-mini'), 'Updated llm.model = gpt-4o-mini');
});
