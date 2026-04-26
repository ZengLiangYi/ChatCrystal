import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyStopDaemonError, getPortFromBaseUrl } from './serve.js';

test('classifyStopDaemonError treats missing process as stale pid cleanup', () => {
  const err = new Error('process missing') as NodeJS.ErrnoException;
  err.code = 'ESRCH';

  assert.deepEqual(classifyStopDaemonError(err), {
    level: 'warning',
    shouldExit: false,
    shouldRemovePidFile: true,
    message: 'Process not found. Cleaned up stale PID file.',
  });
});

test('classifyStopDaemonError keeps unexpected kill failures fatal', () => {
  const err = new Error('access denied') as NodeJS.ErrnoException;
  err.code = 'EPERM';

  assert.deepEqual(classifyStopDaemonError(err), {
    level: 'error',
    shouldExit: true,
    shouldRemovePidFile: false,
    message: 'Failed to stop server: access denied',
  });
});

test('getPortFromBaseUrl supports explicit and default ports', () => {
  assert.equal(getPortFromBaseUrl('http://localhost:3721'), 3721);
  assert.equal(getPortFromBaseUrl('http://localhost'), 80);
  assert.equal(getPortFromBaseUrl('https://chatcrystal.local'), 443);
});
