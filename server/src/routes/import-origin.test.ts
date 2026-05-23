import assert from 'node:assert/strict';
import test from 'node:test';
import { isLocalImportRequestOriginAllowed } from './import.js';

test('local import side effects allow same-machine browser origins', () => {
  assert.equal(isLocalImportRequestOriginAllowed('http://localhost:13721', undefined), true);
  assert.equal(isLocalImportRequestOriginAllowed('http://127.0.0.1:13721', undefined), true);
  assert.equal(isLocalImportRequestOriginAllowed(undefined, 'http://localhost:3721/import'), true);
});

test('local import side effects reject non-local browser origins', () => {
  assert.equal(isLocalImportRequestOriginAllowed('https://example.com', undefined), false);
  assert.equal(isLocalImportRequestOriginAllowed(undefined, 'https://example.com/page'), false);
});

test('local import side effects allow CLI and Electron requests without browser origin headers', () => {
  assert.equal(isLocalImportRequestOriginAllowed(undefined, undefined), true);
});
