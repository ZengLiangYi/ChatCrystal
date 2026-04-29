import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluateExperienceGateSample,
  evaluateExperienceGateSamples,
  formatExperienceGateEvalReport,
  loadExperienceGateEvalDataset,
  loadExperienceGateEvalSamples,
} from './evaluation.js';
import type { ExperienceGateEvalSample } from './evaluation.js';

const acceptedFix: ExperienceGateEvalSample = {
  id: 'debug-ready-race',
  label: 'Debug readiness race',
  expected_decision: 'accept',
  messages: [
    {
      type: 'user',
      content:
        'server/src/routes/memory.test.ts fails with ECONNREFUSED. Need root cause and fix.',
      has_code: true,
    },
    {
      type: 'assistant',
      content:
        'I inspected startup timing, found requests raced server readiness, and verified the fix with npm test.',
      has_tool_use: true,
      has_code: true,
    },
    {
      type: 'user',
      content: '继续，验证修复并沉淀可复用经验。',
    },
  ],
  judge_dimensions: {
    problem_clarity: 18,
    process_depth: 17,
    decision_value: 15,
    outcome_closure: 18,
    reuse_potential: 16,
  },
};

test('evaluateExperienceGateSample evaluates one offline sample without calling an LLM', () => {
  const result = evaluateExperienceGateSample(acceptedFix);

  assert.equal(result.id, acceptedFix.id);
  assert.equal(result.expected_decision, 'accept');
  assert.equal(result.actual_decision, 'accept');
  assert.equal(result.passed, true);
  assert.equal(result.stage, 'judge');
  assert.equal(result.score >= 75, true);
});

test('evaluateExperienceGateSamples reports false accepts and false rejects', () => {
  const summary = evaluateExperienceGateSamples([
    acceptedFix,
    {
      id: 'short-info',
      label: 'Short informational Q&A',
      expected_decision: 'reject',
      messages: [
        { type: 'user', content: 'TypeScript interface 是什么？' },
        { type: 'assistant', content: 'interface 描述对象形状。' },
      ],
    },
    {
      ...acceptedFix,
      id: 'expected-reject-but-accepted',
      label: 'Bad label for calibration',
      expected_decision: 'reject',
    },
    {
      id: 'expected-accept-but-prefiltered',
      label: 'Missing problem despite expected accept',
      expected_decision: 'accept',
      messages: [
        { type: 'user', content: '请解释一下 interface。' },
        { type: 'assistant', content: '它描述对象形状。' },
      ],
    },
  ]);

  assert.equal(summary.total, 4);
  assert.equal(summary.passed, 2);
  assert.equal(summary.failed, 2);
  assert.deepEqual(summary.false_accepts.map((item) => item.id), [
    'expected-reject-but-accepted',
  ]);
  assert.deepEqual(summary.false_rejects.map((item) => item.id), [
    'expected-accept-but-prefiltered',
  ]);
});

test('formatExperienceGateEvalReport prints a compact calibration report', () => {
  const summary = evaluateExperienceGateSamples([acceptedFix]);
  const report = formatExperienceGateEvalReport(summary);

  assert.match(report, /Experience Gate Evaluation/);
  assert.match(report, /Passed: 1\/1/);
  assert.match(report, /False accepts: 0/);
  assert.match(report, /False rejects: 0/);
});

test('loadExperienceGateEvalSamples reads JSON sample files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chatcrystal-eval-'));
  const filePath = join(dir, 'samples.json');
  writeFileSync(
    filePath,
    JSON.stringify({
      schema_version: 1,
      provenance: {
        origin: 'synthetic_calibration_cases',
        contains_real_user_data: false,
        sanitization: ['No samples are copied from local conversation logs.'],
      },
      samples: [acceptedFix],
    }),
    'utf8',
  );

  const samples = loadExperienceGateEvalSamples(filePath);
  const dataset = loadExperienceGateEvalDataset(filePath);

  assert.equal(samples.length, 1);
  assert.equal(samples[0].id, acceptedFix.id);
  assert.equal(samples[0].expected_decision, 'accept');
  assert.equal(dataset.provenance.contains_real_user_data, false);
  assert.equal(dataset.samples.length, 1);
});

test('default experience gate sample set has calibration coverage and passes', () => {
  const samples = loadExperienceGateEvalSamples(
    fileURLToPath(new URL('./eval-samples.json', import.meta.url)),
  );
  const summary = evaluateExperienceGateSamples(samples);

  assert.equal(samples.length >= 30, true);
  assert.equal(
    samples.filter((sample) => sample.expected_decision === 'accept').length >=
      12,
    true,
  );
  assert.equal(
    samples.filter((sample) => sample.expected_decision === 'reject').length >=
      12,
    true,
  );
  assert.equal(summary.failed, 0);
});

test('default experience gate sample set declares synthetic provenance and excludes sensitive local data', () => {
  const dataset = loadExperienceGateEvalDataset(
    fileURLToPath(new URL('./eval-samples.json', import.meta.url)),
  );
  const serialized = JSON.stringify(dataset.samples);
  const forbiddenPatterns = [
    /C:[/\\]Users[/\\]/i,
    /Users[/\\]Rayner/i,
    /\bRayner\b/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b127\.0\.0\.1\b/,
    /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[0-1]))\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
    /\b(?:api[_-]?key|secret|password|token)\s*[:=]/i,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  ];

  assert.equal(dataset.schema_version, 1);
  assert.equal(dataset.provenance.contains_real_user_data, false);
  assert.match(dataset.provenance.origin, /synthetic|desensitized/);
  assert.equal(dataset.provenance.sanitization.length > 0, true);
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(serialized, pattern);
  }
});
