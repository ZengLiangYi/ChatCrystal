import test from 'node:test';
import assert from 'node:assert/strict';
import { decideWritebackAction } from './decision.js';

test('decideWritebackAction skips low-signal summaries', () => {
  const result = decideWritebackAction(
    {
      project_key: 'git:repo',
      outcome_type: 'fix',
      summary: 'Fixed it.',
      root_cause: '',
      resolution: '',
      error_signatures: [],
    },
    [],
  );

  assert.equal(result.decision, 'skipped');
  assert.equal(result.reason, 'low-signal');
});

test('decideWritebackAction merges when the same project has the same root cause and error signature', () => {
  const result = decideWritebackAction(
    {
      project_key: 'git:repo',
      outcome_type: 'fix',
      summary: 'Await server readiness before issuing requests.',
      root_cause: 'Requests raced the server startup',
      resolution: 'Await readiness in the test helper',
      error_signatures: ['ECONNREFUSED'],
    },
    [
      {
        note_id: 7,
        project_key: 'git:repo',
        outcome_type: 'fix',
        root_cause: 'Requests raced the server startup',
        resolution: 'Await readiness in the test helper',
        error_signatures: ['ECONNREFUSED'],
      },
    ],
  );

  assert.equal(result.decision, 'merged');
  assert.equal(result.target_note_id, 7);
});

test('decideWritebackAction does not merge when the remediation differs materially', () => {
  const result = decideWritebackAction(
    {
      project_key: 'git:repo',
      outcome_type: 'fix',
      summary: 'Stabilize readiness before bootstrapping the test server.',
      root_cause: 'Requests raced the server startup',
      resolution: 'Await readiness in the test helper',
      error_signatures: ['ECONNREFUSED'],
    },
    [
      {
        note_id: 9,
        project_key: 'git:repo',
        outcome_type: 'fix',
        root_cause: 'Requests raced the server startup',
        resolution: 'Retry the request with exponential backoff',
        error_signatures: ['ECONNREFUSED'],
      } as any,
    ],
  );

  assert.equal(result.decision, 'created');
  assert.equal(result.target_note_id, null);
});
