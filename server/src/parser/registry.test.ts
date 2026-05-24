import assert from 'node:assert/strict';
import test from 'node:test';
import { registerAdapter } from './registry.js';
import type { SourceAdapter } from './adapter.js';

test('registerAdapter does not write informational logs to stdout', () => {
  const calls: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    calls.push(args.map(String).join(' '));
  };

  try {
    const adapter: SourceAdapter = {
      name: `test-adapter-${Date.now()}`,
      displayName: 'Test Adapter',
      detect: async () => null,
      scan: async () => [],
      parse: async () => {
        throw new Error('parse is not used in this test');
      },
    };

    registerAdapter(adapter);

    assert.deepEqual(calls, []);
  } finally {
    console.log = originalLog;
  }
});
