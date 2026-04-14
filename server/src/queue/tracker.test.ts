import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskTracker } from './tracker.js';

test('isTaskActive is true only for queued and processing tasks', () => {
  const tracker = new TaskTracker();
  const queuedId = 'queued-task';
  const processingId = 'processing-task';
  const completedId = 'completed-task';
  const failedId = 'failed-task';

  tracker.add(queuedId, 'Queued task');
  assert.equal(tracker.isTaskActive(queuedId), true);

  tracker.add(processingId, 'Processing task');
  tracker.start(processingId);
  assert.equal(tracker.isTaskActive(processingId), true);

  tracker.add(completedId, 'Completed task');
  tracker.complete(completedId);
  assert.equal(tracker.isTaskActive(completedId), false);

  tracker.add(failedId, 'Failed task');
  tracker.fail(failedId, 'boom');
  assert.equal(tracker.isTaskActive(failedId), false);
  assert.equal(tracker.isTaskActive('missing-task'), false);
});
