import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SERVER_BASE_URL, normalizeBaseUrl } from './client.js';

test('normalizeBaseUrl defaults missing values to the ChatCrystal API port', () => {
  assert.equal(normalizeBaseUrl(), DEFAULT_SERVER_BASE_URL);
  assert.equal(normalizeBaseUrl(''), DEFAULT_SERVER_BASE_URL);
  assert.equal(normalizeBaseUrl('   '), DEFAULT_SERVER_BASE_URL);
});

test('normalizeBaseUrl adds the ChatCrystal port for local HTTP URLs without explicit ports', () => {
  assert.equal(normalizeBaseUrl('http://localhost'), 'http://localhost:3721');
  assert.equal(normalizeBaseUrl('http://127.0.0.1'), 'http://127.0.0.1:3721');
  assert.equal(normalizeBaseUrl('http://0.0.0.0'), 'http://0.0.0.0:3721');
  assert.equal(normalizeBaseUrl('http://[::1]'), 'http://[::1]:3721');
  assert.equal(normalizeBaseUrl('localhost'), 'http://localhost:3721');
});

test('normalizeBaseUrl preserves explicit ports and non-loopback defaults', () => {
  assert.equal(normalizeBaseUrl('http://localhost:80'), 'http://localhost');
  assert.equal(normalizeBaseUrl('http://localhost:4000'), 'http://localhost:4000');
  assert.equal(normalizeBaseUrl('127.0.0.1:4000'), 'http://127.0.0.1:4000');
  assert.equal(normalizeBaseUrl('https://chatcrystal.local'), 'https://chatcrystal.local');
});

test('normalizeBaseUrl rejects unsupported base URL schemes', () => {
  assert.throws(
    () => normalizeBaseUrl('file:///tmp/chatcrystal.sock'),
    /Only http and https URLs are supported/,
  );
});
