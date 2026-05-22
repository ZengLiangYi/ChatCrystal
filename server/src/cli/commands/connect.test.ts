import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCloudConnectTarget, formatRemoteStatus, redactConnectionForJson } from './connect.js';

test('assertCloudConnectTarget accepts only cloud-mode servers', () => {
  assert.doesNotThrow(() => assertCloudConnectTarget({ cloudMode: true }));
  assert.throws(
    () => assertCloudConnectTarget({ cloudMode: false }),
    /does not report cloud mode/,
  );
  assert.throws(
    () => assertCloudConnectTarget({}),
    /does not report cloud mode/,
  );
});

test('formatRemoteStatus distinguishes saved and local default connections', () => {
  assert.equal(formatRemoteStatus(null), 'No saved remote connection. Using local default.');
  assert.equal(
    formatRemoteStatus({ baseUrl: 'https://chatcrystal.example.com', token: 'token', source: 'saved' }),
    'Saved remote connection: https://chatcrystal.example.com (token set)',
  );
  assert.equal(
    formatRemoteStatus({ baseUrl: 'https://chatcrystal.example.com', source: 'saved' }),
    'Saved remote connection: https://chatcrystal.example.com (token missing)',
  );
});

test('redactConnectionForJson never exposes saved tokens', () => {
  assert.deepEqual(redactConnectionForJson(null), { source: 'local-default', tokenSet: false });
  assert.deepEqual(
    redactConnectionForJson({
      baseUrl: 'https://chatcrystal.example.com',
      token: 'super-secret-token',
      source: 'saved',
    }),
    {
      baseUrl: 'https://chatcrystal.example.com',
      source: 'saved',
      tokenSet: true,
    },
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      redactConnectionForJson({
        baseUrl: 'https://chatcrystal.example.com',
        token: 'super-secret-token',
        source: 'saved',
      }),
      'token',
    ),
    false,
  );
});
