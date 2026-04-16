import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRecallForTaskRequest,
  parseWriteTaskMemoryRequest,
} from './schemas.js';

test('mode=auto normalizes missing source_agent to unknown', () => {
  const parsed = parseWriteTaskMemoryRequest({
    mode: 'auto',
    source_run_key: 'run-123',
    task: {
      goal: 'Fix flaky integration test',
      task_kind: 'debug',
    },
    memory: {
      summary: 'Resolved the flaky timeout by awaiting server readiness.',
      outcome_type: 'fix',
    },
  });

  assert.equal(parsed.task.source_agent, 'unknown');
});

test('mode=auto requires source_run_key', () => {
  assert.throws(
    () =>
      parseWriteTaskMemoryRequest({
        mode: 'auto',
        task: {
          goal: 'Fix flaky integration test',
          task_kind: 'debug',
        },
        memory: {
          summary: 'Resolved the flaky timeout by awaiting server readiness.',
          outcome_type: 'fix',
        },
      }),
    /source_run_key is required when mode=auto/,
  );
});

test('mode=auto rejects scope=global', () => {
  assert.throws(
    () =>
      parseWriteTaskMemoryRequest({
        mode: 'auto',
        source_run_key: 'run-123',
        scope: 'global',
        task: {
          goal: 'Extract reusable pattern',
          task_kind: 'implement',
        },
        memory: {
          summary: 'Documented a reusable helper pattern.',
          outcome_type: 'pattern',
        },
      }),
    /scope=global is only allowed when mode=manual/,
  );
});

test('recall options accept 0 to disable a bucket', () => {
  const parsed = parseRecallForTaskRequest({
    mode: 'task',
    task: {
      goal: 'Inspect timeout failures',
      task_kind: 'debug',
    },
    options: {
      project_limit: 0,
      global_limit: 0,
      include_relations: false,
    },
  });

  assert.equal(parsed.options?.project_limit, 0);
  assert.equal(parsed.options?.global_limit, 0);
  assert.equal(parsed.options?.include_relations, false);
});

test('schemas accept trae as a valid source_agent', () => {
  const parsed = parseWriteTaskMemoryRequest({
    mode: 'manual',
    task: {
      goal: 'Capture a Trae-specific workflow fix',
      task_kind: 'investigate',
      source_agent: 'trae',
    },
    memory: {
      summary: 'Trae persisted agent task content under a different storage key.',
      outcome_type: 'decision',
    },
  });

  assert.equal(parsed.task.source_agent, 'trae');
});
