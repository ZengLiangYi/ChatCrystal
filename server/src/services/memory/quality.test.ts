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
