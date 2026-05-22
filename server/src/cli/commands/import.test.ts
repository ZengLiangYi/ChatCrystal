import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldUseRemoteImport } from './import.js';

test('shouldUseRemoteImport uses server cloud mode before URL shape', () => {
  assert.equal(shouldUseRemoteImport('http://localhost:3721', { cloudMode: true }, 'saved'), true);
  assert.equal(shouldUseRemoteImport('http://localhost:3721', { cloudMode: false }, 'local-default'), false);
  assert.equal(shouldUseRemoteImport('https://chatcrystal.example.com', { cloudMode: true }, 'explicit'), true);
});

test('shouldUseRemoteImport fails closed for configured loopback targets that are not cloud mode', () => {
  assert.throws(
    () => shouldUseRemoteImport('http://localhost:3721', { cloudMode: false }, 'saved'),
    /Refusing local import/,
  );
  assert.throws(
    () => shouldUseRemoteImport('http://0.0.0.0:3721', { cloudMode: false }, 'env'),
    /did not report cloud mode/,
  );
});

test('shouldUseRemoteImport fails closed for non-loopback targets that are not cloud mode', () => {
  assert.throws(
    () => shouldUseRemoteImport('https://chatcrystal.example.com', { cloudMode: false }, 'explicit'),
    /did not report cloud mode/,
  );
  assert.throws(
    () => shouldUseRemoteImport('https://chatcrystal.example.com', {}, 'saved'),
    /did not report cloud mode/,
  );
});
