import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldStartWatcher } from './watcherPolicy.js';

test('standalone local server starts watcher by default', () => {
  assert.equal(shouldStartWatcher({ cloudMode: false }), true);
});

test('cloud server never starts watcher by default', () => {
  assert.equal(shouldStartWatcher({ cloudMode: true }), false);
});

test('electron onboarding can explicitly disable watcher in local mode', () => {
  assert.equal(shouldStartWatcher({ cloudMode: false, startWatcher: false }), false);
});

test('explicit true still cannot start watcher in cloud mode', () => {
  assert.equal(shouldStartWatcher({ cloudMode: true, startWatcher: true }), false);
});
