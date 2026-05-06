import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTaskMemory } from './preflight.js';

test('validateTaskMemory accepts strong candidates and returns visible conclusions', () => {
  const result = validateTaskMemory({
    mode: 'auto',
    source_run_key: 'run-strong-preflight',
    task: {
      goal: 'Fix server readiness race',
      task_kind: 'debug',
      source_agent: 'codex',
    },
    memory: {
      title: 'Server readiness race returns ECONNREFUSED',
      summary: 'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
      outcome_type: 'fix',
      root_cause: 'Client calls hit ECONNREFUSED because they ran before the local server was ready.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
      tags: ['readiness', 'testing'],
    },
  });

  assert.equal(result.mode, 'auto');
  assert.equal(result.accepted, true);
  assert.equal(result.decision, 'accepted');
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.materialized_note.key_conclusions, [
    'Root cause: Client calls hit ECONNREFUSED because they ran before the local server was ready.',
    'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
  ]);
  assert.equal(
    result.materialized_note.raw_payload.summary,
    'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
  );
});

test('validateTaskMemory skips weak auto candidates with note quality warnings', () => {
  const result = validateTaskMemory({
    mode: 'auto',
    source_run_key: 'run-weak-quality-preflight',
    task: {
      goal: 'Fix server readiness validation',
      task_kind: 'debug',
      source_agent: 'codex',
    },
    memory: {
      title: 'Server readiness validation prevents ECONNREFUSED',
      summary: 'Validate server readiness to prevent future failures.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Validate server readiness to prevent future failures.',
    },
  });

  assert.equal(result.accepted, false);
  assert.equal(result.decision, 'skipped');
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
  assert.match(result.materialized_note.embedding_text, /ECONNREFUSED/);
});

test('validateTaskMemory returns structured validation failures before note quality', () => {
  let qualityCalls = 0;

  const result = validateTaskMemory(
    {
      mode: 'auto',
      source_run_key: 'run-low-signal-preflight',
      task: {
        goal: 'Fix flaky test',
        task_kind: 'debug',
        source_agent: 'codex',
      },
      memory: {
        summary: 'The flaky integration test should be captured as a reusable fix candidate.',
        outcome_type: 'fix',
      },
    },
    {
      validateMaterializedNoteQuality: () => {
        qualityCalls++;
        throw new Error('note quality should not run');
      },
    },
  );

  assert.equal(result.accepted, false);
  assert.equal(result.decision, 'skipped');
  assert.equal(result.reason, 'low-signal');
  assert.ok(result.warnings.includes('root_cause_or_resolution'));
  assert.equal(qualityCalls, 0);
  assert.deepEqual(result.materialized_note.key_conclusions, []);
});
