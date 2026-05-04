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
