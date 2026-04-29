import test from 'node:test';
import assert from 'node:assert/strict';
import { extractExperienceSignals } from './signals.js';

test('extractExperienceSignals rejects short informational exchanges', () => {
  const signals = extractExperienceSignals([
    {
      type: 'user',
      content: 'TypeScript interface 是什么？',
      has_tool_use: 0,
      has_code: 0,
    },
    {
      type: 'assistant',
      content: 'interface 用来描述对象形状。',
      has_tool_use: 0,
      has_code: 0,
    },
  ]);

  assert.equal(signals.effective_turns, 1);
  assert.equal(signals.has_problem_signal, false);
  assert.equal(signals.has_outcome_signal, false);
  assert.equal(signals.has_reuse_signal, false);
});

test('extractExperienceSignals detects a debugging loop with code, process, and outcome', () => {
  const signals = extractExperienceSignals([
    {
      type: 'user',
      content:
        'npm test fails with ECONNREFUSED in server/src/routes/memory.test.ts. Need to find root cause and fix it.',
      has_tool_use: 0,
      has_code: 0,
    },
    {
      type: 'assistant',
      content:
        'I inspected the failing test, compared startup timing, and found requests raced server readiness.',
      has_tool_use: 1,
      has_code: 1,
    },
    {
      type: 'user',
      content: '继续，验证修复',
      has_tool_use: 0,
      has_code: 0,
    },
    {
      type: 'assistant',
      content:
        'Resolution: await waitForReady() before issuing requests. Verification passed with npm run test -w server.',
      has_tool_use: 1,
      has_code: 1,
    },
  ]);

  assert.equal(signals.effective_turns, 2);
  assert.equal(signals.has_problem_signal, true);
  assert.equal(signals.has_error_signal, true);
  assert.equal(signals.has_code_signal, true);
  assert.equal(signals.has_process_signal, true);
  assert.equal(signals.has_outcome_signal, true);
});

test('extractExperienceSignals allows dense single-turn decisions', () => {
  const signals = extractExperienceSignals([
    {
      type: 'user',
      content:
        'We need to choose between storing experience gate details in notes or conversations. Because filtered conversations do not create notes, decide to store score, reason, and JSON details on conversations. This makes future retries and audit clear.',
      has_tool_use: 0,
      has_code: 0,
    },
  ]);

  assert.equal(signals.effective_turns, 1);
  assert.equal(signals.has_problem_signal, true);
  assert.equal(signals.has_decision_signal, true);
  assert.equal(signals.has_outcome_signal, true);
  assert.equal(signals.has_reuse_signal, true);
  assert.equal(signals.has_strong_single_turn_signal, true);
});
