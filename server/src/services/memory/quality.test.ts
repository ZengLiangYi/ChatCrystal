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
