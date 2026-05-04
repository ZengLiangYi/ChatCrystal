import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeTaskMemory } from './materialize.js';
import { parseWriteTaskMemoryRequest } from './schemas.js';

function parsed(input: unknown) {
  return parseWriteTaskMemoryRequest(input);
}

test('materializeTaskMemory passes through high-quality visible note fields', () => {
  const request = parsed({
    mode: 'auto',
    source_run_key: 'run-pass-through',
    task: { goal: 'Fix server readiness race', task_kind: 'debug', source_agent: 'codex' },
    memory: {
      title: 'Server readiness race causes ECONNREFUSED',
      summary: 'Requests must wait for server readiness before client calls.',
      outcome_type: 'fix',
      key_conclusions: ['Await readiness before issuing HTTP requests.'],
      root_cause: 'Client calls raced server startup.',
      resolution: 'Block request setup until readiness resolves.',
      tags: ['testing', 'readiness'],
    },
  });

  const note = materializeTaskMemory(request);

  assert.equal(note.title, 'Server readiness race causes ECONNREFUSED');
  assert.equal(note.summary, 'Requests must wait for server readiness before client calls.');
  assert.deepEqual(note.key_conclusions, [
    'Await readiness before issuing HTTP requests.',
    'Root cause: Client calls raced server startup.',
    'Resolution: Block request setup until readiness resolves.',
  ]);
  assert.deepEqual(note.tags, ['readiness', 'testing']);
  assert.equal(note.raw_payload, request.memory);
});

test('materializeTaskMemory lifts reusable structured fields into visible conclusions', () => {
  const request = parsed({
    mode: 'auto',
    source_run_key: 'run-pattern',
    task: { goal: 'Add note deletion E2E', task_kind: 'implement', source_agent: 'codex' },
    memory: {
      summary: 'Deletion flows must verify SQL rows and vector index state together.',
      outcome_type: 'pattern',
      reusable_patterns: ['When deleting notes, assert SQL cleanup and Vectra cleanup in the same E2E run.'],
      decisions: ['Keep Vectra cleanup idempotent because SQLite and vector commits can diverge.'],
      error_signatures: ['foreign_key_check reports orphan rows'],
      files_touched: ['server/src/routes/notes.ts'],
      tags: ['Deletion', ' Vectra ', 'deletion'],
    },
  });

  const note = materializeTaskMemory(request);

  assert.deepEqual(note.key_conclusions, [
    'Pattern: When deleting notes, assert SQL cleanup and Vectra cleanup in the same E2E run.',
    'Decision: Keep Vectra cleanup idempotent because SQLite and vector commits can diverge.',
    'Error signature: foreign_key_check reports orphan rows',
  ]);
  assert.match(note.embedding_text, /Vectra cleanup/);
  assert.match(note.embedding_text, /server\/src\/routes\/notes\.ts/);
  assert.deepEqual(note.tags, ['deletion', 'vectra']);
});

test('materializeTaskMemory does not invent missing claims', () => {
  const request = parsed({
    mode: 'auto',
    source_run_key: 'run-weak',
    task: { goal: 'Check package version', task_kind: 'investigate', source_agent: 'codex' },
    memory: {
      summary: 'Checked package version and local dist output.',
      outcome_type: 'pattern',
      reusable_patterns: [],
    },
  });

  const note = materializeTaskMemory(request);

  assert.equal(note.title, 'Check package version');
  assert.deepEqual(note.key_conclusions, []);
  assert.equal(note.embedding_text.includes('Root cause:'), false);
  assert.equal(note.embedding_text.includes('Resolution:'), false);
});
