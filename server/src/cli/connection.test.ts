import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const configDir = mkdtempSync(join(tmpdir(), 'chatcrystal-client-config-'));
process.env.CHATCRYSTAL_CLIENT_CONFIG_PATH = join(configDir, 'client.json');
delete process.env.CHATCRYSTAL_BASE_URL;
delete process.env.CHATCRYSTAL_API_TOKEN;

const connection = await import('./connection.js');
const { DEFAULT_SERVER_BASE_URL } = await import('./client.js');

test('resolveConnection defaults to the local server without a token', () => {
  connection.clearSavedConnection();

  assert.deepEqual(connection.resolveConnection({}), {
    baseUrl: DEFAULT_SERVER_BASE_URL,
    token: undefined,
    source: 'local-default',
  });
});

test('resolveConnection prioritizes explicit flags over env and saved config', () => {
  connection.saveConnection({
    baseUrl: 'https://saved.example.com',
    token: 'saved-token',
  });
  process.env.CHATCRYSTAL_BASE_URL = 'https://env.example.com';
  process.env.CHATCRYSTAL_API_TOKEN = 'env-token';

  assert.deepEqual(connection.resolveConnection({
    baseUrl: 'https://flag.example.com',
    token: 'flag-token',
  }), {
    baseUrl: 'https://flag.example.com',
    token: 'flag-token',
    source: 'explicit',
  });

  delete process.env.CHATCRYSTAL_BASE_URL;
  delete process.env.CHATCRYSTAL_API_TOKEN;
});

test('resolveConnection uses env URL and token before saved config', () => {
  connection.saveConnection({
    baseUrl: 'https://saved.example.com',
    token: 'saved-token',
  });
  process.env.CHATCRYSTAL_BASE_URL = 'https://env.example.com';
  process.env.CHATCRYSTAL_API_TOKEN = 'env-token';

  assert.deepEqual(connection.resolveConnection({}), {
    baseUrl: 'https://env.example.com',
    token: 'env-token',
    source: 'env',
  });

  delete process.env.CHATCRYSTAL_BASE_URL;
  delete process.env.CHATCRYSTAL_API_TOKEN;
});

test('resolveConnection refuses a token without an explicit or env base URL', () => {
  connection.clearSavedConnection();

  assert.throws(
    () => connection.resolveConnection({ token: 'flag-token' }),
    /--base-url is required when --token is provided/,
  );

  process.env.CHATCRYSTAL_API_TOKEN = 'env-token';
  assert.throws(
    () => connection.resolveConnection({}),
    /CHATCRYSTAL_BASE_URL is required when CHATCRYSTAL_API_TOKEN is provided/,
  );
  delete process.env.CHATCRYSTAL_API_TOKEN;
});

test('saved connection persists base URL and token for later CLI and MCP use', () => {
  connection.clearSavedConnection();

  connection.saveConnection({
    baseUrl: 'chatcrystal.example.com',
    token: 'saved-token',
  });

  assert.equal(existsSync(process.env.CHATCRYSTAL_CLIENT_CONFIG_PATH!), true);
  assert.deepEqual(connection.readSavedConnection(), {
    baseUrl: 'https://chatcrystal.example.com',
    token: 'saved-token',
    source: 'saved',
  });
  assert.deepEqual(connection.resolveConnection({}), {
    baseUrl: 'https://chatcrystal.example.com',
    token: 'saved-token',
    source: 'saved',
  });

  const raw = JSON.parse(readFileSync(process.env.CHATCRYSTAL_CLIENT_CONFIG_PATH!, 'utf-8'));
  assert.equal(raw.version, 1);
  assert.equal(raw.baseUrl, 'https://chatcrystal.example.com');
  assert.equal(raw.token, 'saved-token');

  connection.clearSavedConnection();
  assert.equal(connection.readSavedConnection(), null);
});
