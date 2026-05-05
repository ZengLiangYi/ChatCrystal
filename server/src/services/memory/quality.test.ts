import test from 'node:test';
import assert from 'node:assert/strict';
import type { MaterializedTaskMemoryNote } from '@chatcrystal/shared';
import { validateMaterializedNoteQuality } from './quality.js';

function note(overrides: Partial<MaterializedTaskMemoryNote>): MaterializedTaskMemoryNote {
  return {
    title: 'Server readiness race causes ECONNREFUSED',
    summary: 'Requests must wait for server readiness before client calls.',
    key_conclusions: [
      'Root cause: Client calls raced server startup.',
      'Resolution: Block request setup until readiness resolves.',
    ],
    embedding_text: '',
    tags: [],
    raw_payload: {
      summary: 'Requests must wait for server readiness before client calls.',
      outcome_type: 'fix',
      root_cause: 'Client calls raced server startup.',
      resolution: 'Block request setup until readiness resolves.',
    },
    ...overrides,
  };
}

test('validateMaterializedNoteQuality accepts a readable reusable fix', () => {
  const result = validateMaterializedNoteQuality(note({}), { mode: 'auto' });
  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality accepts natural readiness race fixes', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Server readiness race returns ECONNREFUSED',
    summary: 'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
    key_conclusions: [
      'Root cause: Client calls hit ECONNREFUSED because they ran before the local server was ready.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
    ],
    raw_payload: {
      summary: 'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
      outcome_type: 'fix',
      root_cause: 'Client calls hit ECONNREFUSED because they ran before the local server was ready.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality accepts readiness fixes with reliable outcome wording', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Server readiness race returns ECONNREFUSED',
    summary: 'Wait for Fastify readiness before issuing API requests so startup calls are reliable.',
    key_conclusions: [
      'Root cause: Client calls hit ECONNREFUSED because they ran before the local server was ready.',
      'Resolution: Wait for Fastify readiness before issuing API requests so startup calls are reliable.',
    ],
    raw_payload: {
      summary: 'Wait for Fastify readiness before issuing API requests so startup calls are reliable.',
      outcome_type: 'fix',
      root_cause: 'Client calls hit ECONNREFUSED because they ran before the local server was ready.',
      resolution: 'Wait for Fastify readiness before issuing API requests so startup calls are reliable.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality rejects generic resolutions with concrete root causes', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Server readiness generic validation',
    summary: 'Add validation to prevent future failures.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Add validation to prevent future failures.',
    ],
    raw_payload: {
      summary: 'Add validation to prevent future failures.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Add validation to prevent future failures.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));

  const validateResult = validateMaterializedNoteQuality(note({
    title: 'Server readiness validation prevents ECONNREFUSED',
    summary: 'Validate server readiness to prevent future failures.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Validate server readiness to prevent future failures.',
    ],
    raw_payload: {
      summary: 'Validate server readiness to prevent future failures.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Validate server readiness to prevent future failures.',
    },
  }), { mode: 'auto' });

  assert.equal(validateResult.accepted, false);
  assert.equal(validateResult.reason, 'low-note-quality');
  assert.ok(validateResult.warnings.includes('durable_reusable_lesson'));

  const guardResult = validateMaterializedNoteQuality(note({
    title: 'Server readiness guard prevents ECONNREFUSED',
    summary: 'Add a server readiness guard before API requests to prevent future failures.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Add a server readiness guard before API requests to prevent future failures.',
    ],
    raw_payload: {
      summary: 'Add a server readiness guard before API requests to prevent future failures.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Add a server readiness guard before API requests to prevent future failures.',
    },
  }), { mode: 'auto' });

  assert.equal(guardResult.accepted, false);
  assert.equal(guardResult.reason, 'low-note-quality');
  assert.ok(guardResult.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects generic visible fixes with concrete raw payloads', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Server readiness issue resolved',
    summary: 'The task now works correctly after the expected behavior was fixed.',
    key_conclusions: [
      'Root cause: The issue was fixed successfully.',
      'Resolution: The correct behavior now works.',
    ],
    raw_payload: {
      summary: 'The task now works correctly after the expected behavior was fixed.',
      outcome_type: 'fix',
      root_cause: 'Client calls raced server startup and produced ECONNREFUSED.',
      resolution: 'Add request setup wait for Fastify readiness before client calls.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));

  const reusableResult = validateMaterializedNoteQuality(note({
    title: 'Reusable lesson for future tasks',
    summary: 'This note captures a reusable API request fix for future tasks.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
    ],
    raw_payload: {
      summary: 'This note captures a reusable API request fix for future tasks.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });

  assert.equal(reusableResult.accepted, false);
  assert.equal(reusableResult.reason, 'low-note-quality');
  assert.ok(reusableResult.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects generic title and summary with concrete conclusions', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Task works correctly after fix',
    summary: 'Unknown expected behavior was fixed and task works correctly.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
    ],
    raw_payload: {
      summary: 'Unknown expected behavior was fixed and task works correctly.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects generic reliability visible fields with concrete conclusions', () => {
  const summaryResult = validateMaterializedNoteQuality(note({
    title: 'Backend reliability fix',
    summary: 'This backend reliability fix prevents request failures in future work.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
    ],
    raw_payload: {
      summary: 'This backend reliability fix prevents request failures in future work.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });
  const conclusionResult = validateMaterializedNoteQuality(note({
    title: 'Server readiness race returns ECONNREFUSED',
    summary: 'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
      'Takeaway: This note captures a reusable fix for future tasks.',
    ],
    raw_payload: {
      summary: 'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });
  const futureFailureResult = validateMaterializedNoteQuality(note({
    title: 'Server request future failure prevention',
    summary: 'Server requests now avoid future failures in the expected workflow.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
    ],
    raw_payload: {
      summary: 'Server requests now avoid future failures in the expected workflow.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });
  const routeBoilerplateResult = validateMaterializedNoteQuality(note({
    title: 'API reliability fix for /api/notes',
    summary: 'This /api/notes reliability fix prevents future failures in the expected workflow.',
    key_conclusions: [
      'Root cause: /api/notes returned HTTP 404 because the route was not registered before request setup.',
      'Resolution: Register /api/notes before request setup so API requests use the notes route.',
    ],
    raw_payload: {
      summary: 'This /api/notes reliability fix prevents future failures in the expected workflow.',
      outcome_type: 'fix',
      root_cause: '/api/notes returned HTTP 404 because the route was not registered before request setup.',
      resolution: 'Register /api/notes before request setup so API requests use the notes route.',
    },
  }), { mode: 'auto' });
  const resolvedInvestigationResult = validateMaterializedNoteQuality(note({
    title: 'Server request issue resolved after investigation',
    summary: 'The server request issue was resolved after investigation and testing.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
    ],
    raw_payload: {
      summary: 'The server request issue was resolved after investigation and testing.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });

  assert.equal(summaryResult.accepted, false);
  assert.equal(summaryResult.reason, 'low-note-quality');
  assert.ok(summaryResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(conclusionResult.accepted, false);
  assert.equal(conclusionResult.reason, 'low-note-quality');
  assert.ok(conclusionResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(futureFailureResult.accepted, false);
  assert.equal(futureFailureResult.reason, 'low-note-quality');
  assert.ok(futureFailureResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(routeBoilerplateResult.accepted, false);
  assert.equal(routeBoilerplateResult.reason, 'low-note-quality');
  assert.ok(routeBoilerplateResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(resolvedInvestigationResult.accepted, false);
  assert.equal(resolvedInvestigationResult.reason, 'low-note-quality');
  assert.ok(resolvedInvestigationResult.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects low-quality extra key conclusions', () => {
  const genericTakeawayResult = validateMaterializedNoteQuality(note({
    title: 'Server readiness race returns ECONNREFUSED',
    summary: 'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
      'Takeaway: The task now works correctly.',
    ],
    raw_payload: {
      summary: 'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });
  const diaryTakeawayResult = validateMaterializedNoteQuality(note({
    title: 'Server readiness race returns ECONNREFUSED',
    summary: 'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
      'Takeaway: I verified the fix during local testing.',
    ],
    raw_payload: {
      summary: 'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });
  const releaseValidationResult = validateMaterializedNoteQuality(note({
    title: 'Server readiness race returns ECONNREFUSED',
    summary: 'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
      'Takeaway: Always validate behavior before release.',
    ],
    raw_payload: {
      summary: 'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });
  const routeBoilerplateResult = validateMaterializedNoteQuality(note({
    title: 'API registration ordering caused HTTP 404',
    summary: 'Register /api/notes before request setup to prevent HTTP 404.',
    key_conclusions: [
      'Root cause: /api/notes returned HTTP 404 because the route was not registered before request setup.',
      'Resolution: Register /api/notes before request setup so API requests use the notes route.',
      'Takeaway: This /api/notes reliability fix prevents future failures in the expected workflow.',
    ],
    raw_payload: {
      summary: 'Register /api/notes before request setup to prevent HTTP 404.',
      outcome_type: 'fix',
      root_cause: '/api/notes returned HTTP 404 because the route was not registered before request setup.',
      resolution: 'Register /api/notes before request setup so API requests use the notes route.',
    },
  }), { mode: 'auto' });
  const validateBehaviorResult = validateMaterializedNoteQuality(note({
    title: 'Server readiness race returns ECONNREFUSED',
    summary: 'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
      'Takeaway: Validate behavior.',
    ],
    raw_payload: {
      summary: 'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });
  const localTestingResult = validateMaterializedNoteQuality(note({
    title: 'Server readiness race returns ECONNREFUSED',
    summary: 'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
      'Takeaway: Local testing passed.',
    ],
    raw_payload: {
      summary: 'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });

  assert.equal(genericTakeawayResult.accepted, false);
  assert.equal(genericTakeawayResult.reason, 'low-note-quality');
  assert.ok(genericTakeawayResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(diaryTakeawayResult.accepted, false);
  assert.equal(diaryTakeawayResult.reason, 'low-note-quality');
  assert.ok(diaryTakeawayResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(releaseValidationResult.accepted, false);
  assert.equal(releaseValidationResult.reason, 'low-note-quality');
  assert.ok(releaseValidationResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(routeBoilerplateResult.accepted, false);
  assert.equal(routeBoilerplateResult.reason, 'low-note-quality');
  assert.ok(routeBoilerplateResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(validateBehaviorResult.accepted, false);
  assert.equal(validateBehaviorResult.reason, 'low-note-quality');
  assert.ok(validateBehaviorResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(localTestingResult.accepted, false);
  assert.equal(localTestingResult.reason, 'low-note-quality');
  assert.ok(localTestingResult.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects diary or status summaries with concrete conclusions', () => {
  const diaryResult = validateMaterializedNoteQuality(note({
    title: 'Server readiness race returns ECONNREFUSED',
    summary: 'I checked API requests and added the readiness wait.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
    ],
    raw_payload: {
      summary: 'I checked API requests and added the readiness wait.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });
  const statusResult = validateMaterializedNoteQuality(note({
    title: 'Package version status check',
    summary: 'Checked current local package version status and generated dist output.',
    key_conclusions: [
      'Root cause: Generated dist output kept stale package metadata because the version bump ran after dist generation.',
      'Resolution: Regenerate generated dist output after bumping package metadata so release artifacts carry the new package version.',
    ],
    raw_payload: {
      summary: 'Checked current local package version status and generated dist output.',
      outcome_type: 'fix',
      root_cause: 'Generated dist output kept stale package metadata because the version bump ran after dist generation.',
      resolution: 'Regenerate generated dist output after bumping package metadata so release artifacts carry the new package version.',
    },
  }), { mode: 'auto' });
  const addedResult = validateMaterializedNoteQuality(note({
    title: 'Added server readiness wait after ECONNREFUSED',
    summary: 'Added Fastify readiness wait after checking API request setup.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
    ],
    raw_payload: {
      summary: 'Added Fastify readiness wait after checking API request setup.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });
  const foundResult = validateMaterializedNoteQuality(note({
    title: 'Found readiness race before Fastify startup',
    summary: 'Found client API requests hit ECONNREFUSED before Fastify readiness.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
    ],
    raw_payload: {
      summary: 'Found client API requests hit ECONNREFUSED before Fastify readiness.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });

  const observedResult = validateMaterializedNoteQuality(note({
    title: 'Observed Fastify readiness during API checks',
    summary: 'Observed Fastify readiness behavior during API request checks.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
    ],
    raw_payload: {
      summary: 'Observed Fastify readiness behavior during API request checks.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });
  const testedResult = validateMaterializedNoteQuality(note({
    title: 'Tested server readiness ECONNREFUSED fix',
    summary: 'Tested server readiness fix locally after waiting for Fastify readiness before issuing API requests.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
    ],
    raw_payload: {
      summary: 'Tested server readiness fix locally after waiting for Fastify readiness before issuing API requests.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });

  assert.equal(diaryResult.accepted, false);
  assert.equal(diaryResult.reason, 'low-note-quality');
  assert.ok(diaryResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(statusResult.accepted, false);
  assert.equal(statusResult.reason, 'low-note-quality');
  assert.ok(statusResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(addedResult.accepted, false);
  assert.equal(addedResult.reason, 'low-note-quality');
  assert.ok(addedResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(foundResult.accepted, false);
  assert.equal(foundResult.reason, 'low-note-quality');
  assert.ok(foundResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(observedResult.accepted, false);
  assert.equal(observedResult.reason, 'low-note-quality');
  assert.ok(observedResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(testedResult.accepted, false);
  assert.equal(testedResult.reason, 'low-note-quality');
  assert.ok(testedResult.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects generic visible patterns with concrete raw payloads', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Reusable API request pattern',
    summary: 'Use the correct pattern so API behavior works reliably across future tasks.',
    key_conclusions: ['Pattern: Use the correct pattern for API behavior.'],
    raw_payload: {
      summary: 'Use the correct pattern so API behavior works reliably across future tasks.',
      outcome_type: 'pattern',
      reusable_patterns: ['Wait for Fastify readiness before issuing API requests because ECONNREFUSED happens when client calls race server startup.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects visible status fixes with concrete raw payloads', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Local package version status check',
    summary: 'Checked current local package version status and generated dist output.',
    key_conclusions: [
      'Root cause: Current local package status was checked.',
      'Resolution: Generated dist output was present.',
    ],
    raw_payload: {
      summary: 'Checked current local package version status and generated dist output.',
      outcome_type: 'fix',
      root_cause: 'Generated dist output kept stale package metadata because the version bump ran after dist generation.',
      resolution: 'Regenerate generated dist output after bumping package metadata so release artifacts carry the new package version.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects first-person implementation diary fixes', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Readiness implementation diary fix',
    summary: 'I checked API requests and added the readiness wait.',
    key_conclusions: [
      'Root cause: I checked API requests and they hit ECONNREFUSED because client calls raced server startup.',
      'Resolution: I added Fastify readiness wait before issuing API requests so startup calls are reliable.',
    ],
    raw_payload: {
      summary: 'I checked API requests and added the readiness wait.',
      outcome_type: 'fix',
      root_cause: 'I checked API requests and they hit ECONNREFUSED because client calls raced server startup.',
      resolution: 'I added Fastify readiness wait before issuing API requests so startup calls are reliable.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));

  const foundResult = validateMaterializedNoteQuality(note({
    title: 'Readiness implementation diary fix',
    summary: 'Found readiness race and kept the wait.',
    key_conclusions: [
      'Root cause: I found client calls hit ECONNREFUSED because they ran before the local server was ready.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
    ],
    raw_payload: {
      summary: 'Found readiness race and kept the wait.',
      outcome_type: 'fix',
      root_cause: 'I found client calls hit ECONNREFUSED because they ran before the local server was ready.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });
  const diagnosedResult = validateMaterializedNoteQuality(note({
    title: 'Readiness implementation diary fix',
    summary: 'Diagnosed readiness race and kept the wait.',
    key_conclusions: [
      'Root cause: We diagnosed client calls hit ECONNREFUSED because they ran before the local server was ready.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
    ],
    raw_payload: {
      summary: 'Diagnosed readiness race and kept the wait.',
      outcome_type: 'fix',
      root_cause: 'We diagnosed client calls hit ECONNREFUSED because they ran before the local server was ready.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });
  const switchedResult = validateMaterializedNoteQuality(note({
    title: 'Readiness implementation diary fix',
    summary: 'Switched readiness handling and kept the wait.',
    key_conclusions: [
      'Root cause: Client calls hit ECONNREFUSED because they ran before the local server was ready.',
      'Resolution: We switched request setup to wait for the Fastify readiness promise before issuing API requests.',
    ],
    raw_payload: {
      summary: 'Switched readiness handling and kept the wait.',
      outcome_type: 'fix',
      root_cause: 'Client calls hit ECONNREFUSED because they ran before the local server was ready.',
      resolution: 'We switched request setup to wait for the Fastify readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });
  const discoveredResult = validateMaterializedNoteQuality(note({
    title: 'Readiness implementation diary fix',
    summary: 'We discovered API requests hit ECONNREFUSED before Fastify readiness.',
    key_conclusions: [
      'Root cause: We discovered API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
    ],
    raw_payload: {
      summary: 'We discovered API requests hit ECONNREFUSED before Fastify readiness.',
      outcome_type: 'fix',
      root_cause: 'We discovered API requests hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });
  const confirmedResult = validateMaterializedNoteQuality(note({
    title: 'Server readiness race returns ECONNREFUSED',
    summary: 'I confirmed API requests hit ECONNREFUSED before Fastify readiness.',
    key_conclusions: [
      'Root cause: I confirmed client calls hit ECONNREFUSED because request setup ran before Fastify readiness.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
    ],
    raw_payload: {
      summary: 'I confirmed API requests hit ECONNREFUSED before Fastify readiness.',
      outcome_type: 'fix',
      root_cause: 'I confirmed client calls hit ECONNREFUSED because request setup ran before Fastify readiness.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });
  const laterSentenceResult = validateMaterializedNoteQuality(note({
    title: 'Server readiness race returns ECONNREFUSED',
    summary: 'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
    key_conclusions: [
      'Root cause: Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness. I checked the request setup during implementation.',
      'Resolution: Wait for the Fastify server readiness promise before issuing API requests.',
    ],
    raw_payload: {
      summary: 'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
      outcome_type: 'fix',
      root_cause: 'Client API requests hit ECONNREFUSED because request setup ran before Fastify readiness. I checked the request setup during implementation.',
      resolution: 'Wait for the Fastify server readiness promise before issuing API requests.',
    },
  }), { mode: 'auto' });

  assert.equal(foundResult.accepted, false);
  assert.equal(foundResult.reason, 'low-note-quality');
  assert.ok(foundResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(diagnosedResult.accepted, false);
  assert.equal(diagnosedResult.reason, 'low-note-quality');
  assert.ok(diagnosedResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(switchedResult.accepted, false);
  assert.equal(switchedResult.reason, 'low-note-quality');
  assert.ok(switchedResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(discoveredResult.accepted, false);
  assert.equal(discoveredResult.reason, 'low-note-quality');
  assert.ok(discoveredResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(confirmedResult.accepted, false);
  assert.equal(confirmedResult.reason, 'low-note-quality');
  assert.ok(confirmedResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(laterSentenceResult.accepted, false);
  assert.equal(laterSentenceResult.reason, 'low-note-quality');
  assert.ok(laterSentenceResult.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects #87-like one-off status records in auto mode', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Check local dist and linked core',
    summary: 'Checked npm link, current package version, and local dist output.',
    key_conclusions: ['Version check: local dist was behind package 0.4.9.'],
    raw_payload: {
      summary: 'Checked npm link, current package version, and local dist output.',
      outcome_type: 'pattern',
      reusable_patterns: ['Version check: local dist was behind package 0.4.9.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects first-person implementation diary patterns', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Readiness implementation diary',
    summary: 'I added the readiness wait and then the API request passed after ECONNREFUSED.',
    key_conclusions: ['Pattern: I added Fastify readiness wait before issuing API requests because ECONNREFUSED happens when requests race startup.'],
    raw_payload: {
      summary: 'I added the readiness wait and then the API request passed after ECONNREFUSED.',
      outcome_type: 'pattern',
      reusable_patterns: ['I added Fastify readiness wait before issuing API requests because ECONNREFUSED happens when requests race startup.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects one-off status records disguised as decisions', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Local package version matched dist output',
    summary: 'Current local package version should match the generated dist output.',
    key_conclusions: ['Decision: Current local package version should match generated dist output.'],
    raw_payload: {
      summary: 'Current local package version should match the generated dist output.',
      outcome_type: 'decision',
      decisions: ['Current local package version should match the generated dist output.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('one_off_status'));
});

test('validateMaterializedNoteQuality rejects package version status comparisons disguised as prevention', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Package version status prevents dist mismatch',
    summary: 'Compare current package version before generated dist output to prevent mismatch in local status checks.',
    key_conclusions: ['Decision: Compare current package version before generated dist output to prevent mismatch in local status checks.'],
    raw_payload: {
      summary: 'Compare current package version before generated dist output to prevent mismatch in local status checks.',
      outcome_type: 'decision',
      decisions: ['Compare current package version before generated dist output to prevent mismatch in local status checks.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(
    result.warnings.includes('one_off_status') ||
    result.warnings.includes('durable_reusable_lesson'),
  );
});

test('validateMaterializedNoteQuality rejects package version status comparisons with divergence wording', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Package version status comparison',
    summary: 'Compare current package version before generated dist output because generated dist output diverged during local status checks.',
    key_conclusions: ['Decision: Compare current package version before generated dist output because generated dist output diverged during local status checks.'],
    raw_payload: {
      summary: 'Compare current package version before generated dist output because generated dist output diverged during local status checks.',
      outcome_type: 'decision',
      decisions: ['Compare current package version before generated dist output because generated dist output diverged during local status checks.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(
    result.warnings.includes('one_off_status') ||
    result.warnings.includes('durable_reusable_lesson'),
  );
});

test('validateMaterializedNoteQuality accepts reusable package version fixes', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Normalize package version parsing before dist comparison',
    summary: 'Normalize package version parsing before comparing generated dist output during local release checks.',
    key_conclusions: [
      'Root cause: Inconsistent package version parsing made local release dist comparisons unreliable.',
      'Resolution: Normalize package version parsing before comparing generated dist output during local release checks.',
    ],
    raw_payload: {
      summary: 'Normalize package version parsing before comparing generated dist output during local release checks.',
      outcome_type: 'fix',
      root_cause: 'Inconsistent package version parsing made local release dist comparisons unreliable.',
      resolution: 'Normalize package version parsing before comparing generated dist output during local release checks.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality accepts natural package metadata and dist fixes', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Normalize package metadata before dist comparison',
    summary: 'Normalize package metadata before comparing generated dist output so release checks use the same version source.',
    key_conclusions: [
      'Root cause: Package metadata and generated dist output diverged because version parsing used different formats.',
      'Resolution: Normalize package metadata before comparing generated dist output during release checks.',
    ],
    raw_payload: {
      summary: 'Normalize package metadata before comparing generated dist output so release checks use the same version source.',
      outcome_type: 'fix',
      root_cause: 'Package metadata and generated dist output diverged because version parsing used different formats.',
      resolution: 'Normalize package metadata before comparing generated dist output during release checks.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality accepts package metadata dist comparison patterns', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Normalize package metadata before dist comparison',
    summary: 'Normalize package metadata before comparing generated dist output when version formats make dist comparisons unreliable.',
    key_conclusions: [
      'Pattern: Normalize package metadata before comparing generated dist output because inconsistent version formats made dist comparisons unreliable.',
    ],
    raw_payload: {
      summary: 'Normalize package metadata before comparing generated dist output when version formats make dist comparisons unreliable.',
      outcome_type: 'pattern',
      reusable_patterns: [
        'Normalize package metadata before comparing generated dist output because inconsistent version formats made dist comparisons unreliable.',
      ],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality accepts caused package dist differences', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Normalize prerelease metadata before dist output',
    summary: 'Normalize package version metadata before generating dist output during release checks.',
    key_conclusions: [
      'Root cause: Version normalization stripped prerelease tags and caused generated dist output to differ from package metadata.',
      'Resolution: Normalize package version metadata before generating dist output during release checks.',
    ],
    raw_payload: {
      summary: 'Normalize package version metadata before generating dist output during release checks.',
      outcome_type: 'fix',
      root_cause: 'Version normalization stripped prerelease tags and caused generated dist output to differ from package metadata.',
      resolution: 'Normalize package version metadata before generating dist output during release checks.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality accepts causal package metadata inclusion fixes', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Normalize package metadata before dist generation',
    summary: 'Normalize package metadata before generating dist output so release checks compare the same version format.',
    key_conclusions: [
      'Root cause: Generated dist output included stale package metadata and diverged from package version because version normalization used different formats.',
      'Resolution: Normalize package metadata before generating dist output during release checks.',
    ],
    raw_payload: {
      summary: 'Normalize package metadata before generating dist output so release checks compare the same version format.',
      outcome_type: 'fix',
      root_cause: 'Generated dist output included stale package metadata and diverged from package version because version normalization used different formats.',
      resolution: 'Normalize package metadata before generating dist output during release checks.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality accepts package version bump dist regeneration fixes', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Regenerate dist after package version bump',
    summary: 'Regenerate generated dist output after bumping package metadata so release artifacts carry the new package version.',
    key_conclusions: [
      'Root cause: Generated dist output kept stale package metadata because the version bump ran after dist generation.',
      'Resolution: Regenerate generated dist output after bumping package metadata so release artifacts carry the new package version.',
    ],
    raw_payload: {
      summary: 'Regenerate generated dist output after bumping package metadata so release artifacts carry the new package version.',
      outcome_type: 'fix',
      root_cause: 'Generated dist output kept stale package metadata because the version bump ran after dist generation.',
      resolution: 'Regenerate generated dist output after bumping package metadata so release artifacts carry the new package version.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);

  const inverseResult = validateMaterializedNoteQuality(note({
    title: 'Regenerate dist after package version bump',
    summary: 'Regenerate generated dist output after bumping package metadata so release artifacts carry the new package version.',
    key_conclusions: [
      'Root cause: Generated dist output stayed stale because dist generation ran before the package metadata version bump.',
      'Resolution: Regenerate generated dist output after bumping package metadata so release artifacts carry the new package version.',
    ],
    raw_payload: {
      summary: 'Regenerate generated dist output after bumping package metadata so release artifacts carry the new package version.',
      outcome_type: 'fix',
      root_cause: 'Generated dist output stayed stale because dist generation ran before the package metadata version bump.',
      resolution: 'Regenerate generated dist output after bumping package metadata so release artifacts carry the new package version.',
    },
  }), { mode: 'auto' });

  assert.equal(inverseResult.accepted, true);
  assert.equal(inverseResult.reason, 'note-quality-ok');
  assert.deepEqual(inverseResult.warnings, []);
});

test('validateMaterializedNoteQuality rejects package parsing causes without dist consequence', () => {
  const wrongResult = validateMaterializedNoteQuality(note({
    title: 'Normalize package version parsing before dist output',
    summary: 'Normalize package version parsing before comparing generated dist output during release checks.',
    key_conclusions: [
      'Root cause: Wrong package version parsing was used during generated dist output checks.',
      'Resolution: Normalize package version parsing before comparing generated dist output during release checks.',
    ],
    raw_payload: {
      summary: 'Normalize package version parsing before comparing generated dist output during release checks.',
      outcome_type: 'fix',
      root_cause: 'Wrong package version parsing was used during generated dist output checks.',
      resolution: 'Normalize package version parsing before comparing generated dist output during release checks.',
    },
  }), { mode: 'auto' });
  const inconsistentResult = validateMaterializedNoteQuality(note({
    title: 'Normalize package version parsing before dist output',
    summary: 'Normalize package version parsing before comparing generated dist output during release checks.',
    key_conclusions: [
      'Root cause: Inconsistent package version parsing was used during generated dist output checks.',
      'Resolution: Normalize package version parsing before comparing generated dist output during release checks.',
    ],
    raw_payload: {
      summary: 'Normalize package version parsing before comparing generated dist output during release checks.',
      outcome_type: 'fix',
      root_cause: 'Inconsistent package version parsing was used during generated dist output checks.',
      resolution: 'Normalize package version parsing before comparing generated dist output during release checks.',
    },
  }), { mode: 'auto' });

  assert.equal(wrongResult.accepted, false);
  assert.equal(wrongResult.reason, 'low-note-quality');
  assert.ok(wrongResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(inconsistentResult.accepted, false);
  assert.equal(inconsistentResult.reason, 'low-note-quality');
  assert.ok(inconsistentResult.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects package observation status causes with outcome words', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Package version release checks',
    summary: 'Normalize package version parsing before comparing generated dist output during release checks.',
    key_conclusions: [
      'Root cause: Inconsistent package version parsing and generated dist output mismatch were present during release checks.',
      'Resolution: Normalize package version parsing before comparing generated dist output during release checks.',
    ],
    raw_payload: {
      summary: 'Normalize package version parsing before comparing generated dist output during release checks.',
      outcome_type: 'fix',
      root_cause: 'Inconsistent package version parsing and generated dist output mismatch were present during release checks.',
      resolution: 'Normalize package version parsing before comparing generated dist output during release checks.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects package and dist co-occurrence without causal signal', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Package version release checks',
    summary: 'Normalize package version parsing before comparing generated dist output during release checks.',
    key_conclusions: [
      'Root cause: Package version and generated dist output existed during release checks.',
      'Resolution: Normalize package version parsing before comparing generated dist output during release checks.',
    ],
    raw_payload: {
      summary: 'Normalize package version parsing before comparing generated dist output during release checks.',
      outcome_type: 'fix',
      root_cause: 'Package version and generated dist output existed during release checks.',
      resolution: 'Normalize package version parsing before comparing generated dist output during release checks.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects package and dist existence under because clauses', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Package version release checks',
    summary: 'Normalize package version parsing before comparing generated dist output during release checks.',
    key_conclusions: [
      'Root cause: Package version existed because generated dist output was present during release checks.',
      'Resolution: Normalize package version parsing before comparing generated dist output during release checks.',
    ],
    raw_payload: {
      summary: 'Normalize package version parsing before comparing generated dist output during release checks.',
      outcome_type: 'fix',
      root_cause: 'Package version existed because generated dist output was present during release checks.',
      resolution: 'Normalize package version parsing before comparing generated dist output during release checks.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects package metadata existence even with dist divergence words', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Package metadata release checks',
    summary: 'Normalize package metadata before comparing generated dist output during release checks.',
    key_conclusions: [
      'Root cause: Package metadata existed because generated dist output diverged during release checks.',
      'Resolution: Normalize package metadata before comparing generated dist output during release checks.',
    ],
    raw_payload: {
      summary: 'Normalize package metadata before comparing generated dist output during release checks.',
      outcome_type: 'fix',
      root_cause: 'Package metadata existed because generated dist output diverged during release checks.',
      resolution: 'Normalize package metadata before comparing generated dist output during release checks.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects package metadata was-there existence claims', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Package metadata release checks',
    summary: 'Normalize package metadata before comparing generated dist output during release checks.',
    key_conclusions: [
      'Root cause: Package metadata was there because generated dist output diverged during release checks.',
      'Resolution: Normalize package metadata before comparing generated dist output during release checks.',
    ],
    raw_payload: {
      summary: 'Normalize package metadata before comparing generated dist output during release checks.',
      outcome_type: 'fix',
      root_cause: 'Package metadata was there because generated dist output diverged during release checks.',
      resolution: 'Normalize package metadata before comparing generated dist output during release checks.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects package metadata found or included existence claims', () => {
  const foundResult = validateMaterializedNoteQuality(note({
    title: 'Package metadata release checks',
    summary: 'Normalize package metadata before comparing generated dist output during release checks.',
    key_conclusions: [
      'Root cause: Package metadata was found because generated dist output diverged during release checks.',
      'Resolution: Normalize package metadata before comparing generated dist output during release checks.',
    ],
    raw_payload: {
      summary: 'Normalize package metadata before comparing generated dist output during release checks.',
      outcome_type: 'fix',
      root_cause: 'Package metadata was found because generated dist output diverged during release checks.',
      resolution: 'Normalize package metadata before comparing generated dist output during release checks.',
    },
  }), { mode: 'auto' });
  const includedResult = validateMaterializedNoteQuality(note({
    title: 'Package metadata release checks',
    summary: 'Normalize package metadata before comparing generated dist output during release checks.',
    key_conclusions: [
      'Root cause: Package metadata was included because generated dist output diverged during release checks.',
      'Resolution: Normalize package metadata before comparing generated dist output during release checks.',
    ],
    raw_payload: {
      summary: 'Normalize package metadata before comparing generated dist output during release checks.',
      outcome_type: 'fix',
      root_cause: 'Package metadata was included because generated dist output diverged during release checks.',
      resolution: 'Normalize package metadata before comparing generated dist output during release checks.',
    },
  }), { mode: 'auto' });

  assert.equal(foundResult.accepted, false);
  assert.equal(foundResult.reason, 'low-note-quality');
  assert.ok(foundResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(includedResult.accepted, false);
  assert.equal(includedResult.reason, 'low-note-quality');
  assert.ok(includedResult.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects package metadata detected or observed existence claims', () => {
  const detectedResult = validateMaterializedNoteQuality(note({
    title: 'Package metadata release checks',
    summary: 'Normalize package metadata before comparing generated dist output during release checks.',
    key_conclusions: [
      'Root cause: Package metadata was detected because generated dist output diverged during release checks.',
      'Resolution: Normalize package metadata before comparing generated dist output during release checks.',
    ],
    raw_payload: {
      summary: 'Normalize package metadata before comparing generated dist output during release checks.',
      outcome_type: 'fix',
      root_cause: 'Package metadata was detected because generated dist output diverged during release checks.',
      resolution: 'Normalize package metadata before comparing generated dist output during release checks.',
    },
  }), { mode: 'auto' });
  const observedResult = validateMaterializedNoteQuality(note({
    title: 'Package metadata release checks',
    summary: 'Normalize package metadata before comparing generated dist output during release checks.',
    key_conclusions: [
      'Root cause: Package metadata was observed because generated dist output diverged during release checks.',
      'Resolution: Normalize package metadata before comparing generated dist output during release checks.',
    ],
    raw_payload: {
      summary: 'Normalize package metadata before comparing generated dist output during release checks.',
      outcome_type: 'fix',
      root_cause: 'Package metadata was observed because generated dist output diverged during release checks.',
      resolution: 'Normalize package metadata before comparing generated dist output during release checks.',
    },
  }), { mode: 'auto' });

  assert.equal(detectedResult.accepted, false);
  assert.equal(detectedResult.reason, 'low-note-quality');
  assert.ok(detectedResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(observedResult.accepted, false);
  assert.equal(observedResult.reason, 'low-note-quality');
  assert.ok(observedResult.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects active package artifact observation causes', () => {
  const observedResult = validateMaterializedNoteQuality(note({
    title: 'Package metadata release checks',
    summary: 'Normalize package metadata before comparing generated dist output during release checks.',
    key_conclusions: [
      'Root cause: Observed package metadata because generated dist output diverged during release checks.',
      'Resolution: Normalize package metadata before comparing generated dist output during release checks.',
    ],
    raw_payload: {
      summary: 'Normalize package metadata before comparing generated dist output during release checks.',
      outcome_type: 'fix',
      root_cause: 'Observed package metadata because generated dist output diverged during release checks.',
      resolution: 'Normalize package metadata before comparing generated dist output during release checks.',
    },
  }), { mode: 'auto' });
  const foundResult = validateMaterializedNoteQuality(note({
    title: 'Package version release checks',
    summary: 'Normalize package version parsing before comparing generated dist output during release checks.',
    key_conclusions: [
      'Root cause: Found package version because generated dist output diverged during release checks.',
      'Resolution: Normalize package version parsing before comparing generated dist output during release checks.',
    ],
    raw_payload: {
      summary: 'Normalize package version parsing before comparing generated dist output during release checks.',
      outcome_type: 'fix',
      root_cause: 'Found package version because generated dist output diverged during release checks.',
      resolution: 'Normalize package version parsing before comparing generated dist output during release checks.',
    },
  }), { mode: 'auto' });

  assert.equal(observedResult.accepted, false);
  assert.equal(observedResult.reason, 'low-note-quality');
  assert.ok(observedResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(foundResult.accepted, false);
  assert.equal(foundResult.reason, 'low-note-quality');
  assert.ok(foundResult.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects package metadata visible existence causes', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Package metadata release checks',
    summary: 'Normalize package metadata before comparing generated dist output during release checks.',
    key_conclusions: [
      'Root cause: Package metadata was visible because generated dist output diverged during release checks.',
      'Resolution: Normalize package metadata before comparing generated dist output during release checks.',
    ],
    raw_payload: {
      summary: 'Normalize package metadata before comparing generated dist output during release checks.',
      outcome_type: 'fix',
      root_cause: 'Package metadata was visible because generated dist output diverged during release checks.',
      resolution: 'Normalize package metadata before comparing generated dist output during release checks.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality accepts API registration ordering HTTP failures', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'API registration ordering caused HTTP 404',
    summary: 'Register /api/notes before request setup so API requests do not return HTTP 404.',
    key_conclusions: [
      'Root cause: API requests returned HTTP 404 because /api/notes registration ran after request setup.',
      'Resolution: Add /api/notes before issuing API requests.',
    ],
    raw_payload: {
      summary: 'Register /api/notes before request setup so API requests do not return HTTP 404.',
      outcome_type: 'fix',
      root_cause: 'API requests returned HTTP 404 because /api/notes registration ran after request setup.',
      resolution: 'Add /api/notes before issuing API requests.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality accepts register-based HTTP failure fixes', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'API registration ordering caused HTTP 404',
    summary: 'Register /api/notes before request setup so API requests do not return HTTP 404.',
    key_conclusions: [
      'Root cause: API requests returned HTTP 404 because /api/notes registration ran after request setup.',
      'Resolution: Register /api/notes before issuing API requests.',
    ],
    raw_payload: {
      summary: 'Register /api/notes before request setup so API requests do not return HTTP 404.',
      outcome_type: 'fix',
      root_cause: 'API requests returned HTTP 404 because /api/notes registration ran after request setup.',
      resolution: 'Register /api/notes before issuing API requests.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality accepts natural HTTP registration ordering fixes', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'API registration ordering caused HTTP 404',
    summary: 'Register /api/notes before issuing API requests to prevent HTTP 404.',
    key_conclusions: [
      'Root cause: API requests returned HTTP 404 because /api/notes was registered after request setup.',
      'Resolution: Register /api/notes before issuing API requests.',
    ],
    raw_payload: {
      summary: 'Register /api/notes before issuing API requests to prevent HTTP 404.',
      outcome_type: 'fix',
      root_cause: 'API requests returned HTTP 404 because /api/notes was registered after request setup.',
      resolution: 'Register /api/notes before issuing API requests.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality accepts moved or placed HTTP registration ordering fixes', () => {
  const moveResult = validateMaterializedNoteQuality(note({
    title: 'API registration ordering caused HTTP 404',
    summary: 'Move /api/notes registration before request setup so API requests do not return HTTP 404.',
    key_conclusions: [
      'Root cause: API requests returned HTTP 404 because /api/notes registration ran after request setup.',
      'Resolution: Move /api/notes registration before request setup so API requests do not return HTTP 404.',
    ],
    raw_payload: {
      summary: 'Move /api/notes registration before request setup so API requests do not return HTTP 404.',
      outcome_type: 'fix',
      root_cause: 'API requests returned HTTP 404 because /api/notes registration ran after request setup.',
      resolution: 'Move /api/notes registration before request setup so API requests do not return HTTP 404.',
    },
  }), { mode: 'auto' });
  const placeResult = validateMaterializedNoteQuality(note({
    title: 'API registration ordering caused HTTP 404',
    summary: 'Place /api/notes registration before request setup so API requests do not return HTTP 404.',
    key_conclusions: [
      'Root cause: API requests returned HTTP 404 because /api/notes registration ran after request setup.',
      'Resolution: Place /api/notes registration before request setup so API requests do not return HTTP 404.',
    ],
    raw_payload: {
      summary: 'Place /api/notes registration before request setup so API requests do not return HTTP 404.',
      outcome_type: 'fix',
      root_cause: 'API requests returned HTTP 404 because /api/notes registration ran after request setup.',
      resolution: 'Place /api/notes registration before request setup so API requests do not return HTTP 404.',
    },
  }), { mode: 'auto' });

  assert.equal(moveResult.accepted, true);
  assert.equal(moveResult.reason, 'note-quality-ok');
  assert.deepEqual(moveResult.warnings, []);
  assert.equal(placeResult.accepted, true);
  assert.equal(placeResult.reason, 'note-quality-ok');
  assert.deepEqual(placeResult.warnings, []);
});

test('validateMaterializedNoteQuality accepts not-registered HTTP route fixes', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'API registration ordering caused HTTP 404',
    summary: 'Register /api/notes before issuing API requests.',
    key_conclusions: [
      'Root cause: API requests returned HTTP 404 because /api/notes route was not registered before request setup.',
      'Resolution: Register /api/notes before issuing API requests.',
    ],
    raw_payload: {
      summary: 'Register /api/notes before issuing API requests.',
      outcome_type: 'fix',
      root_cause: 'API requests returned HTTP 404 because /api/notes route was not registered before request setup.',
      resolution: 'Register /api/notes before issuing API requests.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality accepts concrete parser TypeError fixes', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Codex JSONL parser skips partial response_item events',
    summary: 'Validate response_item.content before reading Codex parser fields so partial JSONL events do not throw TypeError.',
    key_conclusions: [
      'Root cause: Codex JSONL parsing threw TypeError because response_item.content was read before validating the partial event shape.',
      'Resolution: Validate response_item.content before reading parser fields and skip partial Codex events without content.',
    ],
    raw_payload: {
      summary: 'Validate response_item.content before reading Codex parser fields so partial JSONL events do not throw TypeError.',
      outcome_type: 'fix',
      root_cause: 'Codex JSONL parsing threw TypeError because response_item.content was read before validating the partial event shape.',
      resolution: 'Validate response_item.content before reading parser fields and skip partial Codex events without content.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality accepts concrete NODE_ENV HTTP failure fixes', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Production API config import ordering caused HTTP 500',
    summary: 'Validate NODE_ENV before request setup to prevent HTTP 500 in production API requests.',
    key_conclusions: [
      'Root cause: Production API requests returned HTTP 500 because config imported NODE_ENV after request setup.',
      'Resolution: Validate NODE_ENV before request setup to prevent HTTP 500 in production API requests.',
    ],
    raw_payload: {
      summary: 'Validate NODE_ENV before request setup to prevent HTTP 500 in production API requests.',
      outcome_type: 'fix',
      root_cause: 'Production API requests returned HTTP 500 because config imported NODE_ENV after request setup.',
      resolution: 'Validate NODE_ENV before request setup to prevent HTTP 500 in production API requests.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality accepts natural NODE_ENV HTTP import ordering fixes', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Production API config import ordering caused HTTP 500',
    summary: 'Validate NODE_ENV before request setup to prevent HTTP 500 in production API requests.',
    key_conclusions: [
      'Root cause: Production API requests returned HTTP 500 because NODE_ENV config was imported after request setup.',
      'Resolution: Validate NODE_ENV before request setup to prevent HTTP 500 in production API requests.',
    ],
    raw_payload: {
      summary: 'Validate NODE_ENV before request setup to prevent HTTP 500 in production API requests.',
      outcome_type: 'fix',
      root_cause: 'Production API requests returned HTTP 500 because NODE_ENV config was imported after request setup.',
      resolution: 'Validate NODE_ENV before request setup to prevent HTTP 500 in production API requests.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality accepts NODE_ENV import resolutions', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Production API config import ordering caused HTTP 500',
    summary: 'Import NODE_ENV config before request setup to prevent HTTP 500 in production API requests.',
    key_conclusions: [
      'Root cause: Production API requests returned HTTP 500 because NODE_ENV config was imported after request setup.',
      'Resolution: Import NODE_ENV config before request setup to prevent HTTP 500 in production API requests.',
    ],
    raw_payload: {
      summary: 'Import NODE_ENV config before request setup to prevent HTTP 500 in production API requests.',
      outcome_type: 'fix',
      root_cause: 'Production API requests returned HTTP 500 because NODE_ENV config was imported after request setup.',
      resolution: 'Import NODE_ENV config before request setup to prevent HTTP 500 in production API requests.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality rejects generic HTTP root cause rationales', () => {
  const correctnessResult = validateMaterializedNoteQuality(note({
    title: 'NODE_ENV HTTP 500 fix',
    summary: 'Validate NODE_ENV before request setup to prevent HTTP 500 in production API requests.',
    key_conclusions: [
      'Root cause: API returned HTTP 500 because correctness mattered.',
      'Resolution: Validate NODE_ENV before request setup to prevent HTTP 500 in production API requests.',
    ],
    raw_payload: {
      summary: 'Validate NODE_ENV before request setup to prevent HTTP 500 in production API requests.',
      outcome_type: 'fix',
      root_cause: 'API returned HTTP 500 because correctness mattered.',
      resolution: 'Validate NODE_ENV before request setup to prevent HTTP 500 in production API requests.',
    },
  }), { mode: 'auto' });
  const reliabilityResult = validateMaterializedNoteQuality(note({
    title: 'NODE_ENV HTTP 500 fix',
    summary: 'Validate NODE_ENV before request setup to prevent HTTP 500 in production API requests.',
    key_conclusions: [
      'Root cause: API returned HTTP 500 because reliability mattered.',
      'Resolution: Validate NODE_ENV before request setup to prevent HTTP 500 in production API requests.',
    ],
    raw_payload: {
      summary: 'Validate NODE_ENV before request setup to prevent HTTP 500 in production API requests.',
      outcome_type: 'fix',
      root_cause: 'API returned HTTP 500 because reliability mattered.',
      resolution: 'Validate NODE_ENV before request setup to prevent HTTP 500 in production API requests.',
    },
  }), { mode: 'auto' });

  assert.equal(correctnessResult.accepted, false);
  assert.equal(correctnessResult.reason, 'low-note-quality');
  assert.ok(correctnessResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(reliabilityResult.accepted, false);
  assert.equal(reliabilityResult.reason, 'low-note-quality');
  assert.ok(reliabilityResult.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects generic HTTP rationales with route tokens', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'API HTTP 404 generic route fix',
    summary: 'Register /api/notes before issuing API requests.',
    key_conclusions: [
      'Root cause: API returned HTTP 404 because correctness mattered; missing route.',
      'Resolution: Register /api/notes before issuing API requests.',
    ],
    raw_payload: {
      summary: 'Register /api/notes before issuing API requests.',
      outcome_type: 'fix',
      root_cause: 'API returned HTTP 404 because correctness mattered; missing route.',
      resolution: 'Register /api/notes before issuing API requests.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects weak not-correct HTTP root causes', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'API route weak HTTP fix',
    summary: 'Register /api/notes before issuing API requests.',
    key_conclusions: [
      'Root cause: API route was not correct before request setup, so API requests returned HTTP 404.',
      'Resolution: Register /api/notes before issuing API requests.',
    ],
    raw_payload: {
      summary: 'Register /api/notes before issuing API requests.',
      outcome_type: 'fix',
      root_cause: 'API route was not correct before request setup, so API requests returned HTTP 404.',
      resolution: 'Register /api/notes before issuing API requests.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects generic environment decisions', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Checked NODE_ENV value because deployment should use production',
    summary: 'Checked NODE_ENV value because deployment should use production.',
    key_conclusions: ['Decision: NODE_ENV should use production pattern.'],
    raw_payload: {
      summary: 'Checked NODE_ENV value because deployment should use production.',
      outcome_type: 'decision',
      decisions: ['NODE_ENV should use production pattern.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
  assert.ok(result.warnings.includes('one_off_status'));
});

test('validateMaterializedNoteQuality rejects environment verification snapshots', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'NODE_ENV production verification',
    summary: 'Verified NODE_ENV production before request setup.',
    key_conclusions: ['Decision: Validate NODE_ENV before request setup to prevent HTTP 500 in production API requests.'],
    raw_payload: {
      summary: 'Verified NODE_ENV production before request setup.',
      outcome_type: 'decision',
      decisions: ['Validate NODE_ENV before request setup to prevent HTTP 500 in production API requests.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects generic environment status decisions with action words', () => {
  const validateResult = validateMaterializedNoteQuality(note({
    title: 'Validate NODE_ENV deployment status',
    summary: 'Validate NODE_ENV deployment status because production environment is expected.',
    key_conclusions: ['Decision: Validate NODE_ENV deployment status because production environment is expected.'],
    raw_payload: {
      summary: 'Validate NODE_ENV deployment status because production environment is expected.',
      outcome_type: 'decision',
      decisions: ['Validate NODE_ENV deployment status because production environment is expected.'],
    },
  }), { mode: 'auto' });
  const investigateResult = validateMaterializedNoteQuality(note({
    title: 'Investigate local package version status',
    summary: 'Investigate local package version status because deployment should use production.',
    key_conclusions: ['Decision: Investigate local package version status because deployment should use production.'],
    raw_payload: {
      summary: 'Investigate local package version status because deployment should use production.',
      outcome_type: 'decision',
      decisions: ['Investigate local package version status because deployment should use production.'],
    },
  }), { mode: 'auto' });

  assert.equal(validateResult.accepted, false);
  assert.equal(validateResult.reason, 'low-note-quality');
  assert.ok(validateResult.warnings.includes('durable_reusable_lesson'));
  assert.ok(validateResult.warnings.includes('one_off_status'));
  assert.equal(investigateResult.accepted, false);
  assert.equal(investigateResult.reason, 'low-note-quality');
  assert.ok(investigateResult.warnings.includes('durable_reusable_lesson'));
  assert.ok(investigateResult.warnings.includes('one_off_status'));
});

test('validateMaterializedNoteQuality rejects placeholder root cause and resolution fields', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Server readiness note with placeholder diagnosis',
    summary: 'Requests must wait for server readiness before client calls.',
    key_conclusions: [
      'Root cause: n/a.',
      'Resolution: ok.',
    ],
    raw_payload: {
      summary: 'Requests must wait for server readiness before client calls.',
      outcome_type: 'fix',
      root_cause: 'n/a',
      resolution: 'ok',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects long placeholder root cause and resolution fields', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Generic fix note with vague diagnosis',
    summary: 'The task needed investigation and an appropriate change was applied.',
    key_conclusions: [
      'Root cause: The root cause was unknown because the task needed investigation.',
      'Resolution: The resolution was to fix the issue with the appropriate change.',
    ],
    raw_payload: {
      summary: 'The task needed investigation and an appropriate change was applied.',
      outcome_type: 'fix',
      root_cause: 'The root cause was unknown because the task needed investigation',
      resolution: 'The resolution was to fix the issue with the appropriate change',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects vague behavior root cause and resolution claims', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Generic implementation behavior fix',
    summary: 'Fix implementation behavior so the task works correctly going forward.',
    key_conclusions: [
      'Root cause: The implementation did not handle the expected behavior correctly in this task.',
      'Resolution: Fix implementation behavior so the task works correctly going forward.',
    ],
    raw_payload: {
      summary: 'Fix implementation behavior so the task works correctly going forward.',
      outcome_type: 'fix',
      root_cause: 'The implementation did not handle the expected behavior correctly in this task.',
      resolution: 'Fix implementation behavior so the task works correctly going forward.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects generic compare and validate lessons', () => {
  const compareResult = validateMaterializedNoteQuality(note({
    title: 'Generic comparison decision',
    summary: 'The task should compare values because that is the expected pattern.',
    key_conclusions: ['Decision: The task should compare values because that is the expected pattern.'],
    raw_payload: {
      summary: 'The task should compare values because that is the expected pattern.',
      outcome_type: 'decision',
      decisions: ['The task should compare values because that is the expected pattern.'],
    },
  }), { mode: 'auto' });
  const validateResult = validateMaterializedNoteQuality(note({
    title: 'Generic validation pattern',
    summary: 'The pattern should validate input because validation is important for correctness.',
    key_conclusions: ['Pattern: The pattern should validate input because validation is important for correctness.'],
    raw_payload: {
      summary: 'The pattern should validate input because validation is important for correctness.',
      outcome_type: 'pattern',
      reusable_patterns: ['The pattern should validate input because validation is important for correctness.'],
    },
  }), { mode: 'auto' });

  assert.equal(compareResult.accepted, false);
  assert.equal(compareResult.reason, 'low-note-quality');
  assert.ok(compareResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(validateResult.accepted, false);
  assert.equal(validateResult.reason, 'low-note-quality');
  assert.ok(validateResult.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects boilerplate API validation patterns', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Generic API validation pattern',
    summary: 'The pattern should validate API input because validation is important for correctness.',
    key_conclusions: ['Pattern: The pattern should validate API input because validation is important for correctness.'],
    raw_payload: {
      summary: 'The pattern should validate API input because validation is important for correctness.',
      outcome_type: 'pattern',
      reusable_patterns: ['The pattern should validate API input because validation is important for correctness.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects boilerplate config pattern claims', () => {
  const apiResult = validateMaterializedNoteQuality(note({
    title: 'Generic API config indexing decision',
    summary: 'API config should index the correct pattern because correctness matters.',
    key_conclusions: ['Decision: API config should index the correct pattern because correctness matters.'],
    raw_payload: {
      summary: 'API config should index the correct pattern because correctness matters.',
      outcome_type: 'decision',
      decisions: ['API config should index the correct pattern because correctness matters.'],
    },
  }), { mode: 'auto' });
  const serverResult = validateMaterializedNoteQuality(note({
    title: 'Generic server config cache pattern',
    summary: 'Server config should cache the correct pattern because correctness matters.',
    key_conclusions: ['Pattern: Server config should cache the correct pattern because correctness matters.'],
    raw_payload: {
      summary: 'Server config should cache the correct pattern because correctness matters.',
      outcome_type: 'pattern',
      reusable_patterns: ['Server config should cache the correct pattern because correctness matters.'],
    },
  }), { mode: 'auto' });

  assert.equal(apiResult.accepted, false);
  assert.equal(apiResult.reason, 'low-note-quality');
  assert.ok(apiResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(serverResult.accepted, false);
  assert.equal(serverResult.reason, 'low-note-quality');
  assert.ok(serverResult.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality accepts concrete DATA_DIR Electron config fixes', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Set DATA_DIR before importing Electron server',
    summary: 'Set DATA_DIR before importing the Electron server so embedded startup uses the intended ChatCrystal data directory.',
    key_conclusions: [
      'Root cause: The Electron main process imported the server before DATA_DIR was configured, so startup used the default data directory.',
      'Resolution: Set DATA_DIR before importing the Electron server entrypoint.',
    ],
    raw_payload: {
      summary: 'Set DATA_DIR before importing the Electron server so embedded startup uses the intended ChatCrystal data directory.',
      outcome_type: 'fix',
      root_cause: 'The Electron main process imported the server before DATA_DIR was configured, so startup used the default data directory.',
      resolution: 'Set DATA_DIR before importing the Electron server entrypoint.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality accepts natural DATA_DIR import-ordering fixes', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Configure DATA_DIR before Electron server import',
    summary: 'Set DATA_DIR before importing the Electron server entrypoint so embedded startup uses the intended data directory.',
    key_conclusions: [
      'Root cause: The Electron main process imported the server before DATA_DIR was set, so startup fell back to the default data directory.',
      'Resolution: Set DATA_DIR before importing the Electron server entrypoint.',
    ],
    raw_payload: {
      summary: 'Set DATA_DIR before importing the Electron server entrypoint so embedded startup uses the intended data directory.',
      outcome_type: 'fix',
      root_cause: 'The Electron main process imported the server before DATA_DIR was set, so startup fell back to the default data directory.',
      resolution: 'Set DATA_DIR before importing the Electron server entrypoint.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality accepts causal self-contained DATA_DIR decisions', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'DATA_DIR Electron import ordering decision',
    summary: 'Set DATA_DIR before importing the Electron server entrypoint to prevent fallback to the default data directory.',
    key_conclusions: ['Decision: Set DATA_DIR before importing the Electron server entrypoint to prevent fallback to the default data directory.'],
    raw_payload: {
      summary: 'Set DATA_DIR before importing the Electron server entrypoint to prevent fallback to the default data directory.',
      outcome_type: 'decision',
      decisions: ['Set DATA_DIR before importing the Electron server entrypoint to prevent fallback to the default data directory.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality accepts fallback decisions with existence context', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'DATA_DIR prevents default fallback',
    summary: 'Set DATA_DIR before importing the Electron server entrypoint to prevent fallback to the default data directory when it exists.',
    key_conclusions: ['Decision: Set DATA_DIR before importing the Electron server entrypoint to prevent fallback to the default data directory when it exists.'],
    raw_payload: {
      summary: 'Set DATA_DIR before importing the Electron server entrypoint to prevent fallback to the default data directory when it exists.',
      outcome_type: 'decision',
      decisions: ['Set DATA_DIR before importing the Electron server entrypoint to prevent fallback to the default data directory when it exists.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality accepts default data directory fallback wording', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'DATA_DIR prevents default fallback',
    summary: 'Set DATA_DIR before importing the Electron server entrypoint to prevent default data directory fallback when it exists.',
    key_conclusions: ['Decision: Set DATA_DIR before importing the Electron server entrypoint to prevent default data directory fallback when it exists.'],
    raw_payload: {
      summary: 'Set DATA_DIR before importing the Electron server entrypoint to prevent default data directory fallback when it exists.',
      outcome_type: 'decision',
      decisions: ['Set DATA_DIR before importing the Electron server entrypoint to prevent default data directory fallback when it exists.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'note-quality-ok');
  assert.deepEqual(result.warnings, []);
});

test('validateMaterializedNoteQuality rejects generic unreliable behavior consequences', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'DATA_DIR import ordering prevents unreliable behavior',
    summary: 'Set DATA_DIR before importing the Electron server entrypoint to prevent unreliable behavior.',
    key_conclusions: ['Decision: Set DATA_DIR before importing the Electron server entrypoint to prevent unreliable behavior.'],
    raw_payload: {
      summary: 'Set DATA_DIR before importing the Electron server entrypoint to prevent unreliable behavior.',
      outcome_type: 'decision',
      decisions: ['Set DATA_DIR before importing the Electron server entrypoint to prevent unreliable behavior.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects bare fallback consequences', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'API fallback decision',
    summary: 'Index /api/notes before request setup to prevent fallback.',
    key_conclusions: ['Decision: Index /api/notes before request setup to prevent fallback.'],
    raw_payload: {
      summary: 'Index /api/notes before request setup to prevent fallback.',
      outcome_type: 'decision',
      decisions: ['Index /api/notes before request setup to prevent fallback.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects default data directory existence decisions', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'DATA_DIR default directory existence decision',
    summary: 'Set DATA_DIR before importing the Electron server entrypoint because the default data directory exists.',
    key_conclusions: ['Decision: Set DATA_DIR before importing the Electron server entrypoint because the default data directory exists.'],
    raw_payload: {
      summary: 'Set DATA_DIR before importing the Electron server entrypoint because the default data directory exists.',
      outcome_type: 'decision',
      decisions: ['Set DATA_DIR before importing the Electron server entrypoint because the default data directory exists.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects default data directory on-disk decisions', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'DATA_DIR default directory ordering decision',
    summary: 'Set DATA_DIR before importing the Electron server entrypoint because the default data directory is on disk.',
    key_conclusions: ['Decision: Set DATA_DIR before importing the Electron server entrypoint because the default data directory is on disk.'],
    raw_payload: {
      summary: 'Set DATA_DIR before importing the Electron server entrypoint because the default data directory is on disk.',
      outcome_type: 'decision',
      decisions: ['Set DATA_DIR before importing the Electron server entrypoint because the default data directory is on disk.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects default data directory fallback existence decisions', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'DATA_DIR fallback existence decision',
    summary: 'Set DATA_DIR before importing the Electron server entrypoint because default data directory fallback existed.',
    key_conclusions: ['Decision: Set DATA_DIR before importing the Electron server entrypoint because default data directory fallback existed.'],
    raw_payload: {
      summary: 'Set DATA_DIR before importing the Electron server entrypoint because default data directory fallback existed.',
      outcome_type: 'decision',
      decisions: ['Set DATA_DIR before importing the Electron server entrypoint because default data directory fallback existed.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects fallback-to-default-directory existence decisions', () => {
  const existedResult = validateMaterializedNoteQuality(note({
    title: 'DATA_DIR fallback existence decision',
    summary: 'Set DATA_DIR before importing the Electron server entrypoint because fallback to the default data directory existed.',
    key_conclusions: ['Decision: Set DATA_DIR before importing the Electron server entrypoint because fallback to the default data directory existed.'],
    raw_payload: {
      summary: 'Set DATA_DIR before importing the Electron server entrypoint because fallback to the default data directory existed.',
      outcome_type: 'decision',
      decisions: ['Set DATA_DIR before importing the Electron server entrypoint because fallback to the default data directory existed.'],
    },
  }), { mode: 'auto' });
  const onDiskResult = validateMaterializedNoteQuality(note({
    title: 'DATA_DIR fallback existence decision',
    summary: 'Set DATA_DIR before importing the Electron server entrypoint because fallback to the default data directory was on disk.',
    key_conclusions: ['Decision: Set DATA_DIR before importing the Electron server entrypoint because fallback to the default data directory was on disk.'],
    raw_payload: {
      summary: 'Set DATA_DIR before importing the Electron server entrypoint because fallback to the default data directory was on disk.',
      outcome_type: 'decision',
      decisions: ['Set DATA_DIR before importing the Electron server entrypoint because fallback to the default data directory was on disk.'],
    },
  }), { mode: 'auto' });

  assert.equal(existedResult.accepted, false);
  assert.equal(existedResult.reason, 'low-note-quality');
  assert.ok(existedResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(onDiskResult.accepted, false);
  assert.equal(onDiskResult.reason, 'low-note-quality');
  assert.ok(onDiskResult.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects generic object-only mechanisms', () => {
  const addResult = validateMaterializedNoteQuality(note({
    title: 'Generic API config addition',
    summary: 'Add API config because it should work.',
    key_conclusions: ['Decision: Add API config because it should work.'],
    raw_payload: {
      summary: 'Add API config because it should work.',
      outcome_type: 'decision',
      decisions: ['Add API config because it should work.'],
    },
  }), { mode: 'auto' });
  const cacheResult = validateMaterializedNoteQuality(note({
    title: 'Generic server config cache pattern',
    summary: 'Cache server config because it should work.',
    key_conclusions: ['Pattern: Cache server config because it should work.'],
    raw_payload: {
      summary: 'Cache server config because it should work.',
      outcome_type: 'pattern',
      reusable_patterns: ['Cache server config because it should work.'],
    },
  }), { mode: 'auto' });

  assert.equal(addResult.accepted, false);
  assert.equal(addResult.reason, 'low-note-quality');
  assert.ok(addResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(cacheResult.accepted, false);
  assert.equal(cacheResult.reason, 'low-note-quality');
  assert.ok(cacheResult.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects generic object-only root cause and resolution', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Generic API config fix',
    summary: 'Add API config so the server works.',
    key_conclusions: [
      'Root cause: API config was wrong.',
      'Resolution: Add API config so the server works.',
    ],
    raw_payload: {
      summary: 'Add API config so the server works.',
      outcome_type: 'fix',
      root_cause: 'API config was wrong.',
      resolution: 'Add API config so the server works.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects concrete identifiers with vague work rationales', () => {
  const dataDirResult = validateMaterializedNoteQuality(note({
    title: 'API config DATA_DIR decision',
    summary: 'Set API config to DATA_DIR so API config should work.',
    key_conclusions: ['Decision: Set API config to DATA_DIR so API config should work.'],
    raw_payload: {
      summary: 'Set API config to DATA_DIR so API config should work.',
      outcome_type: 'decision',
      decisions: ['Set API config to DATA_DIR so API config should work.'],
    },
  }), { mode: 'auto' });
  const reliabilityResult = validateMaterializedNoteQuality(note({
    title: 'DATA_DIR reliability decision',
    summary: 'Set DATA_DIR to the right value for reliability.',
    key_conclusions: ['Decision: Set DATA_DIR to the right value for reliability.'],
    raw_payload: {
      summary: 'Set DATA_DIR to the right value for reliability.',
      outcome_type: 'decision',
      decisions: ['Set DATA_DIR to the right value for reliability.'],
    },
  }), { mode: 'auto' });
  const portResult = validateMaterializedNoteQuality(note({
    title: 'PORT config correctness decision',
    summary: 'Set server config to PORT because it should work correctly.',
    key_conclusions: ['Decision: Set server config to PORT because it should work correctly.'],
    raw_payload: {
      summary: 'Set server config to PORT because it should work correctly.',
      outcome_type: 'decision',
      decisions: ['Set server config to PORT because it should work correctly.'],
    },
  }), { mode: 'auto' });
  const apiResult = validateMaterializedNoteQuality(note({
    title: 'API route reliability pattern',
    summary: 'Add /api/notes config for reliability and correctness.',
    key_conclusions: ['Pattern: Add /api/notes config for reliability and correctness.'],
    raw_payload: {
      summary: 'Add /api/notes config for reliability and correctness.',
      outcome_type: 'pattern',
      reusable_patterns: ['Add /api/notes config for reliability and correctness.'],
    },
  }), { mode: 'auto' });

  assert.equal(dataDirResult.accepted, false);
  assert.equal(dataDirResult.reason, 'low-note-quality');
  assert.ok(dataDirResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(reliabilityResult.accepted, false);
  assert.equal(reliabilityResult.reason, 'low-note-quality');
  assert.ok(reliabilityResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(portResult.accepted, false);
  assert.equal(portResult.reason, 'low-note-quality');
  assert.ok(portResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(apiResult.accepted, false);
  assert.equal(apiResult.reason, 'low-note-quality');
  assert.ok(apiResult.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects reliability rationales with concrete identifiers', () => {
  const routeResult = validateMaterializedNoteQuality(note({
    title: 'API notes route reliability decision',
    summary: 'Index /api/notes before request setup timing so the route is reliable.',
    key_conclusions: ['Decision: Index /api/notes before request setup timing so the route is reliable.'],
    raw_payload: {
      summary: 'Index /api/notes before request setup timing so the route is reliable.',
      outcome_type: 'decision',
      decisions: ['Index /api/notes before request setup timing so the route is reliable.'],
    },
  }), { mode: 'auto' });
  const portResult = validateMaterializedNoteQuality(note({
    title: 'PORT configuration reliability decision',
    summary: 'Set PORT before importing the default data directory so configuration is reliable.',
    key_conclusions: ['Decision: Set PORT before importing the default data directory so configuration is reliable.'],
    raw_payload: {
      summary: 'Set PORT before importing the default data directory so configuration is reliable.',
      outcome_type: 'decision',
      decisions: ['Set PORT before importing the default data directory so configuration is reliable.'],
    },
  }), { mode: 'auto' });

  assert.equal(routeResult.accepted, false);
  assert.equal(routeResult.reason, 'low-note-quality');
  assert.ok(routeResult.warnings.includes('durable_reusable_lesson'));
  assert.equal(portResult.accepted, false);
  assert.equal(portResult.reason, 'low-note-quality');
  assert.ok(portResult.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects identifier order decisions without consequences', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'DATA_DIR PORT API ordering decision',
    summary: 'Set DATA_DIR before PORT when configuring /api/notes request setup.',
    key_conclusions: ['Decision: Set DATA_DIR before PORT when configuring /api/notes request setup.'],
    raw_payload: {
      summary: 'Set DATA_DIR before PORT when configuring /api/notes request setup.',
      outcome_type: 'decision',
      decisions: ['Set DATA_DIR before PORT when configuring /api/notes request setup.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects generic prevention wording without named consequences', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'DATA_DIR ordering prevents generic failure',
    summary: 'Set DATA_DIR before server request setup to prevent failure in future runs.',
    key_conclusions: ['Decision: Set DATA_DIR before server request setup to prevent failure in future runs.'],
    raw_payload: {
      summary: 'Set DATA_DIR before server request setup to prevent failure in future runs.',
      outcome_type: 'decision',
      decisions: ['Set DATA_DIR before server request setup to prevent failure in future runs.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects generic readiness root cause and resolution', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Server readiness generic fix',
    summary: 'Use a better approach to handle server readiness properly.',
    key_conclusions: [
      'Root cause: Server readiness handling was incomplete during startup.',
      'Resolution: Use a better approach to handle server readiness properly.',
    ],
    raw_payload: {
      summary: 'Use a better approach to handle server readiness properly.',
      outcome_type: 'fix',
      root_cause: 'Server readiness handling was incomplete during startup.',
      resolution: 'Use a better approach to handle server readiness properly.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects readiness fixes with weak root causes', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Server readiness generic fix',
    summary: 'Wait for server readiness before API requests.',
    key_conclusions: [
      'Root cause: Server readiness was not correct before API requests.',
      'Resolution: Wait for server readiness before API requests.',
    ],
    raw_payload: {
      summary: 'Wait for server readiness before API requests.',
      outcome_type: 'fix',
      root_cause: 'Server readiness was not correct before API requests.',
      resolution: 'Wait for server readiness before API requests.',
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects error signatures with weak resolutions', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Server readiness weak ECONNREFUSED fix',
    summary: 'Use a better approach to handle server readiness properly.',
    key_conclusions: [
      'Root cause: Client calls raced server startup and produced ECONNREFUSED.',
      'Resolution: Use a better approach to handle server readiness properly.',
      'Error signature: ECONNREFUSED.',
    ],
    raw_payload: {
      summary: 'Use a better approach to handle server readiness properly.',
      outcome_type: 'fix',
      root_cause: 'Client calls raced server startup and produced ECONNREFUSED.',
      resolution: 'Use a better approach to handle server readiness properly.',
      error_signatures: ['ECONNREFUSED'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});

test('validateMaterializedNoteQuality rejects persisted status/version decisions', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Persist local package version status',
    summary: 'Persist checked current local package version status and generated dist output.',
    key_conclusions: ['Decision: Persist checked current local package version status and generated dist output.'],
    raw_payload: {
      summary: 'Persist checked current local package version status and generated dist output.',
      outcome_type: 'decision',
      decisions: ['Persist checked current local package version status and generated dist output.'],
    },
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(
    result.warnings.includes('one_off_status') ||
    result.warnings.includes('durable_reusable_lesson'),
  );
});

test('validateMaterializedNoteQuality requires visible key conclusions', () => {
  const result = validateMaterializedNoteQuality(note({
    key_conclusions: [],
  }), { mode: 'auto' });

  assert.equal(result.accepted, false);
  assert.ok(result.warnings.includes('key_conclusions'));
});

test('validateMaterializedNoteQuality allows manual readable notes with reuse warning', () => {
  const result = validateMaterializedNoteQuality(note({
    title: 'Manual note about release check',
    summary: 'The release check confirmed the current local package state.',
    key_conclusions: ['The local package state was checked before release.'],
    raw_payload: {
      summary: 'The release check confirmed the current local package state.',
      outcome_type: 'decision',
      decisions: ['The local package state was checked before release.'],
    },
  }), { mode: 'manual' });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'manual-note-quality-warning');
  assert.ok(result.warnings.includes('durable_reusable_lesson'));
});
