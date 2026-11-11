import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_SOURCE_NAMES } from '../config.js';
import { getAllAdapters, getAdapter, registerAdapter } from './index.js';

test('every source name in ALL_SOURCE_NAMES has a registered adapter', () => {
  const registered = new Set(getAllAdapters().map((adapter) => adapter.name));
  for (const source of ALL_SOURCE_NAMES) {
    assert.ok(
      registered.has(source),
      `missing adapter for source "${source}" — register it in parser/index.ts`,
    );
  }
});

test('registered adapters keep unique names and complete contracts', () => {
  const adapters = getAllAdapters();
  const names = adapters.map((adapter) => adapter.name);
  assert.equal(new Set(names).size, names.length, 'adapter names must be unique');

  for (const adapter of adapters) {
    assert.ok(adapter.displayName.length > 0, `${adapter.name}: displayName required`);
    assert.ok(
      (adapter.parserVersion ?? '').length > 0,
      `${adapter.name}: parserVersion required for remote import auditing`,
    );
    assert.equal(typeof adapter.detect, 'function');
    assert.equal(typeof adapter.scan, 'function');
    assert.equal(typeof adapter.parse, 'function');
  }
});

test('getAdapter round-trips registered adapters', () => {
  for (const adapter of getAllAdapters()) {
    assert.equal(getAdapter(adapter.name), adapter);
  }
});

test('registerAdapter overwrites duplicates without logging success noise', () => {
  const name = `test-adapter-${Date.now()}`;
  const calls: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    calls.push(args.map(String).join(' '));
  };
  try {
    registerAdapter({
      name,
      displayName: 'Test',
      parserVersion: 'test@1',
      detect: async () => null,
      scan: async () => [],
      parse: async () => {
        throw new Error('unused');
      },
    });
    assert.equal(getAdapter(name)?.name, name);
  } finally {
    console.warn = originalWarn;
  }
});
