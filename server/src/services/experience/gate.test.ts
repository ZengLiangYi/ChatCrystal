import test from 'node:test';
import assert from 'node:assert/strict';
import {
  combineConversationGateDecision,
  evaluateConversationExperience,
  loadConversationSignalMessages,
  markConversationFiltered,
  prefilterConversationExperience,
  validateStructuredMemoryCandidate,
} from './gate.js';
import type { ExperienceGateDecision, ExperienceSignals } from './schemas.js';

const baseSignals: ExperienceSignals = {
  effective_turns: 3,
  content_chars: 2400,
  has_problem_signal: true,
  has_error_signal: false,
  has_code_signal: true,
  has_process_signal: true,
  has_decision_signal: true,
  has_outcome_signal: true,
  has_reuse_signal: true,
  has_strong_single_turn_signal: false,
};

test('prefilterConversationExperience rejects short informational content before LLM judge', () => {
  const decision = prefilterConversationExperience({
    ...baseSignals,
    effective_turns: 1,
    content_chars: 120,
    has_problem_signal: false,
    has_code_signal: false,
    has_outcome_signal: false,
    has_reuse_signal: false,
  });

  assert.equal(decision?.decision, 'reject');
  assert.equal(decision?.score, 0);
  assert.ok(decision?.reasons.includes('low-signal'));
  assert.ok(decision?.missing_signals.includes('problem'));
});

test('prefilterConversationExperience accepts strong single-turn candidates for LLM judge', () => {
  const decision = prefilterConversationExperience({
    ...baseSignals,
    effective_turns: 1,
    content_chars: 950,
    has_code_signal: false,
    has_strong_single_turn_signal: true,
  });

  assert.equal(decision, null);
});

test('prefilterConversationExperience accepts concise strong single-turn decisions', () => {
  const decision = prefilterConversationExperience({
    ...baseSignals,
    effective_turns: 1,
    content_chars: 220,
    has_error_signal: false,
    has_code_signal: false,
    has_strong_single_turn_signal: true,
  });

  assert.equal(decision, null);
});

test('combineConversationGateDecision accepts high-scoring judged conversations', () => {
  const decision = combineConversationGateDecision(baseSignals, {
    problem_clarity: 17,
    process_depth: 16,
    decision_value: 15,
    outcome_closure: 16,
    reuse_potential: 15,
  });

  assert.equal(decision.decision, 'accept');
  assert.equal(decision.score >= 75, true);
});

test('combineConversationGateDecision rejects missing outcome even when judge score is high', () => {
  const decision = combineConversationGateDecision(
    {
      ...baseSignals,
      has_outcome_signal: false,
    },
    {
      problem_clarity: 20,
      process_depth: 20,
      decision_value: 20,
      outcome_closure: 18,
      reuse_potential: 18,
    },
  );

  assert.equal(decision.decision, 'reject');
  assert.ok(decision.missing_signals.includes('outcome'));
});

test('combineConversationGateDecision allows high-scoring fixes without explicit reuse wording', () => {
  const decision = combineConversationGateDecision(
    {
      ...baseSignals,
      has_reuse_signal: false,
    },
    {
      problem_clarity: 19,
      process_depth: 18,
      decision_value: 16,
      outcome_closure: 18,
      reuse_potential: 19,
    },
  );

  assert.equal(decision.decision, 'accept');
  assert.ok(decision.missing_signals.includes('reuse'));
});

test('validateStructuredMemoryCandidate rejects fix memories without root cause or resolution', () => {
  const decision = validateStructuredMemoryCandidate({
    summary: 'Fixed a flaky test.',
    outcome_type: 'fix',
  });

  assert.equal(decision?.decision, 'reject');
  assert.equal(decision?.reasons[0], 'low-signal');
  assert.ok(decision?.missing_signals.includes('root_cause_or_resolution'));
});

test('validateStructuredMemoryCandidate rejects decision memories without decisions', () => {
  const decision = validateStructuredMemoryCandidate({
    summary: 'We picked the lighter option.',
    outcome_type: 'decision',
  });

  assert.equal(decision?.decision, 'reject');
  assert.ok(decision?.missing_signals.includes('decisions'));
});

test('validateStructuredMemoryCandidate accepts pattern memories with reusable patterns', () => {
  const decision = validateStructuredMemoryCandidate({
    summary:
      'Use a gate before persistence so low-quality candidates do not pollute the experience library.',
    outcome_type: 'pattern',
    reusable_patterns: [
      'Put quality gates at trusted Core boundaries, not only in agent prompts.',
    ],
  });

  assert.equal(decision, null);
});

test('validateStructuredMemoryCandidate accepts concise Chinese experience summaries', () => {
  const decision = validateStructuredMemoryCandidate({
    summary: '修复启动竞态：请求必须等待服务 ready，否则会触发 ECONNREFUSED。',
    outcome_type: 'fix',
    resolution: '请求前等待服务 ready。',
  });

  assert.equal(decision, null);
});

test('validateStructuredMemoryCandidate accepts concise structured English fixes', () => {
  const decision = validateStructuredMemoryCandidate({
    summary: 'Await readiness before requests.',
    outcome_type: 'fix',
    root_cause: 'Requests raced server startup.',
    resolution: 'Wait for server readiness before issuing requests.',
  });

  assert.equal(decision, null);
});

test('loadConversationSignalMessages returns ordered non-empty signal rows', () => {
  const calls: unknown[][] = [];
  const messages = loadConversationSignalMessages(
    {
      exec: (sql, params) => {
        calls.push([sql, params]);
        return [
          {
            columns: ['type', 'content', 'has_tool_use', 'has_code'],
            values: [
              ['user', 'Problem in server/src/a.ts', 0, 1],
              ['assistant', 'Resolution verified.', 1, 0],
            ],
          },
        ];
      },
    },
    'conv-1',
  );

  assert.deepEqual(messages, [
    {
      type: 'user',
      content: 'Problem in server/src/a.ts',
      has_tool_use: 0,
      has_code: 1,
    },
    {
      type: 'assistant',
      content: 'Resolution verified.',
      has_tool_use: 1,
      has_code: 0,
    },
  ]);
  assert.equal(String(calls[0][0]).includes('ORDER BY sort_order ASC'), true);
  assert.deepEqual(calls[0][1], ['conv-1']);
});

test('evaluateConversationExperience skips judge for prefiltered low-signal conversations', async () => {
  let judgeCalls = 0;
  const decision = await evaluateConversationExperience('conv-low', 'transcript', {
    db: {
      exec: () => [
        {
          columns: ['type', 'content', 'has_tool_use', 'has_code'],
          values: [
            ['user', 'TypeScript interface 是什么？', 0, 0],
            ['assistant', 'interface 描述对象形状。', 0, 0],
          ],
        },
      ],
    },
    judge: async () => {
      judgeCalls++;
      return {
        problem_clarity: 20,
        process_depth: 20,
        decision_value: 20,
        outcome_closure: 20,
        reuse_potential: 20,
      };
    },
  });

  assert.equal(decision.decision, 'reject');
  assert.equal(judgeCalls, 0);
});

test('evaluateConversationExperience combines judge dimensions for candidates that pass prefilter', async () => {
  const decision = await evaluateConversationExperience('conv-good', 'transcript', {
    db: {
      exec: () => [
        {
          columns: ['type', 'content', 'has_tool_use', 'has_code'],
          values: [
            [
              'user',
              'server/src/routes/memory.test.ts fails with ECONNREFUSED. Need root cause and fix.',
              0,
              1,
            ],
            [
              'assistant',
              'I inspected the request flow, found the race, and verified the resolution with npm test.',
              1,
              1,
            ],
            [
              'user',
              'Capture the reusable readiness pattern and decision.',
              0,
              0,
            ],
          ],
        },
      ],
    },
    judge: async () => ({
      problem_clarity: 17,
      process_depth: 16,
      decision_value: 15,
      outcome_closure: 16,
      reuse_potential: 15,
    }),
  });

  assert.equal(decision.decision, 'accept');
});

test('markConversationFiltered persists audit fields and saves', () => {
  const runs: unknown[][] = [];
  let saved = false;
  const decision: ExperienceGateDecision = {
    decision: 'reject',
    score: 0,
    confidence: 0.9,
    reasons: ['low-signal'],
    missing_signals: ['problem'],
    dimensions: {
      problem_clarity: 0,
      process_depth: 0,
      decision_value: 0,
      outcome_closure: 0,
      reuse_potential: 0,
    },
  };

  markConversationFiltered('conv-low', decision, {
    db: {
      run: (sql, params) => {
        runs.push([sql, params]);
        return undefined as never;
      },
    },
    save: () => {
      saved = true;
    },
  });

  assert.equal(String(runs[0][0]).includes("status = 'filtered'"), true);
  assert.deepEqual(runs[0][1], [
    0,
    'low-signal',
    JSON.stringify(decision),
    'conv-low',
  ]);
  assert.equal(saved, true);
});
