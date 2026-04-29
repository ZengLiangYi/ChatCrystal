import { generateObject } from 'ai';
import { getDatabase, saveDatabase } from '../../db/index.js';
import { resultToObjects } from '../../db/utils.js';
import { getLanguageModel } from '../llm.js';
import { extractExperienceSignals } from './signals.js';
import {
  ExperienceDimensionsSchema,
  type ExperienceDimensions,
  type ExperienceGateDecision,
  type ExperienceSignals,
  ZERO_DIMENSIONS,
} from './schemas.js';

const LOW_SIGNAL_REASONS = new Set([
  'low-signal',
  'filtered',
  'no reusable experience',
  'no-reusable-experience',
]);

type DatabaseLike = ReturnType<typeof getDatabase>;

type StructuredMemoryCandidate = {
  summary: string;
  outcome_type: 'pitfall' | 'fix' | 'pattern' | 'decision';
  root_cause?: string;
  resolution?: string;
  reusable_patterns?: string[];
  pitfalls?: string[];
  decisions?: string[];
};

function rejectDecision(
  reason: string,
  missingSignals: string[],
  score = 0,
  dimensions: ExperienceDimensions = ZERO_DIMENSIONS,
): ExperienceGateDecision {
  return {
    decision: 'reject',
    score,
    confidence: 0.9,
    reasons: [reason],
    missing_signals: missingSignals,
    dimensions,
  };
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasItems(value: unknown) {
  return Array.isArray(value) && value.some((item) => hasText(item));
}

function hasMeaningfulSummary(value: unknown) {
  if (!hasText(value)) return false;
  const text = value.trim();
  const compactLength = text.replace(/\s+/g, '').length;
  const hasCjk = /[\u3400-\u9fff]/.test(text);
  return compactLength >= (hasCjk ? 18 : 24);
}

function deterministicBonus(signals: ExperienceSignals) {
  return Math.min(
    10,
    (signals.has_error_signal ? 3 : 0) +
      (signals.has_code_signal ? 2 : 0) +
      (signals.has_process_signal ? 2 : 0) +
      (signals.has_decision_signal ? 3 : 0),
  );
}

function criticalPenalty(signals: ExperienceSignals) {
  return (
    (!signals.has_outcome_signal ? 20 : 0) +
    (!signals.has_reuse_signal ? 20 : 0) +
    (!signals.has_process_signal && !signals.has_decision_signal ? 30 : 0) +
    (signals.effective_turns < 2 && !signals.has_strong_single_turn_signal
      ? 25
      : 0)
  );
}

export function isLowSignalGateReason(
  reason: string | null | undefined,
): boolean {
  return LOW_SIGNAL_REASONS.has((reason ?? '').trim().toLowerCase());
}

export function prefilterConversationExperience(
  signals: ExperienceSignals,
): ExperienceGateDecision | null {
  const missing: string[] = [];
  if (!signals.has_problem_signal) missing.push('problem');
  if (!signals.has_outcome_signal) missing.push('outcome');
  if (!signals.has_reuse_signal) missing.push('reuse');

  if (
    signals.content_chars < 800 &&
    !signals.has_error_signal &&
    !signals.has_code_signal &&
    !signals.has_strong_single_turn_signal
  ) {
    return rejectDecision('low-signal', missing);
  }
  if (!signals.has_problem_signal) {
    return rejectDecision('missing-problem', missing);
  }
  if (signals.effective_turns < 2 && !signals.has_strong_single_turn_signal) {
    return rejectDecision('single-turn-low-density', missing);
  }
  if (!signals.has_outcome_signal && !signals.has_reuse_signal) {
    return rejectDecision('no-reusable-experience', missing);
  }
  return null;
}

export function combineConversationGateDecision(
  signals: ExperienceSignals,
  dimensions: ExperienceDimensions,
): ExperienceGateDecision {
  const llmScore = Object.values(dimensions).reduce(
    (sum, value) => sum + value,
    0,
  );
  const score = Math.max(
    0,
    Math.min(100, llmScore + deterministicBonus(signals) - criticalPenalty(signals)),
  );
  const missing = [
    ...(!signals.has_problem_signal ? ['problem'] : []),
    ...(!signals.has_outcome_signal ? ['outcome'] : []),
    ...(!signals.has_reuse_signal ? ['reuse'] : []),
  ];

  if (missing.includes('outcome')) {
    return {
      decision: 'reject',
      score,
      confidence: 0.85,
      reasons: ['critical-signal-missing'],
      missing_signals: missing,
      dimensions,
    };
  }

  const decision =
    score >= 75 ||
    (score >= 65 &&
      dimensions.outcome_closure >= 14 &&
      dimensions.reuse_potential >= 14)
      ? 'accept'
      : score >= 55
        ? 'borderline'
        : 'reject';

  return {
    decision,
    score,
    confidence: 0.75,
    reasons:
      decision === 'accept'
        ? ['experience-threshold-met']
        : ['experience-threshold-not-met'],
    missing_signals: missing,
    dimensions,
  };
}

export function validateStructuredMemoryCandidate(
  memory: StructuredMemoryCandidate,
): ExperienceGateDecision | null {
  const missing: string[] = [];

  if (!hasMeaningfulSummary(memory.summary)) {
    missing.push('summary');
  }

  const hasExperienceCore =
    hasText(memory.root_cause) ||
    hasText(memory.resolution) ||
    hasItems(memory.decisions) ||
    hasItems(memory.reusable_patterns) ||
    hasItems(memory.pitfalls);

  if (!hasExperienceCore) {
    missing.push('experience_core');
  }

  if (
    memory.outcome_type === 'fix' &&
    !hasText(memory.root_cause) &&
    !hasText(memory.resolution)
  ) {
    missing.push('root_cause_or_resolution');
  }
  if (
    memory.outcome_type === 'pitfall' &&
    (!hasItems(memory.pitfalls) ||
      (!hasText(memory.resolution) && !hasItems(memory.reusable_patterns)))
  ) {
    missing.push('pitfalls_and_resolution_or_pattern');
  }
  if (memory.outcome_type === 'decision' && !hasItems(memory.decisions)) {
    missing.push('decisions');
  }
  if (
    memory.outcome_type === 'pattern' &&
    !hasItems(memory.reusable_patterns)
  ) {
    missing.push('reusable_patterns');
  }

  if (missing.length === 0) return null;
  return rejectDecision('low-signal', missing);
}

export function loadConversationSignalMessages(
  db: Pick<DatabaseLike, 'exec'>,
  conversationId: string,
) {
  const result = db.exec(
    `SELECT type, content, has_tool_use, has_code
       FROM messages
      WHERE conversation_id = ?
        AND NOT (has_tool_use = 1 AND (content = '' OR content IS NULL))
      ORDER BY sort_order ASC`,
    [conversationId],
  );
  return resultToObjects(result).map((row) => ({
    type: String(row.type ?? ''),
    content: String(row.content ?? ''),
    has_tool_use: Number(row.has_tool_use ?? 0),
    has_code: Number(row.has_code ?? 0),
  }));
}

export async function judgeConversationExperience(transcript: string) {
  const { object } = await generateObject({
    model: getLanguageModel(),
    schema: ExperienceDimensionsSchema,
    system:
      '你是 ChatCrystal 的经验质量评审器。只根据 rubric 打分，不生成笔记。每项 0-20：problem_clarity, process_depth, decision_value, outcome_closure, reuse_potential。',
    prompt: transcript,
    maxOutputTokens: 512,
    maxRetries: 2,
  });
  return object;
}

export async function evaluateConversationExperience(
  conversationId: string,
  transcript: string,
  deps: {
    db?: Pick<DatabaseLike, 'exec'>;
    judge?: (transcript: string) => Promise<ExperienceDimensions>;
  } = {},
) {
  const db = deps.db ?? getDatabase();
  const messages = loadConversationSignalMessages(db, conversationId);
  const signals = extractExperienceSignals(messages);
  const prefilter = prefilterConversationExperience(signals);
  if (prefilter) return prefilter;
  const dimensions = await (deps.judge ?? judgeConversationExperience)(
    transcript,
  );
  return combineConversationGateDecision(signals, dimensions);
}

export function markConversationFiltered(
  conversationId: string,
  decision: ExperienceGateDecision,
  deps: {
    db?: Pick<DatabaseLike, 'run'>;
    save?: () => void;
  } = {},
) {
  const db = deps.db ?? getDatabase();
  db.run(
    `UPDATE conversations
        SET status = 'filtered',
            experience_score = ?,
            experience_gate_reason = ?,
            experience_gate_details = ?,
            updated_at = datetime('now')
      WHERE id = ?`,
    [
      decision.score,
      decision.reasons[0] ?? 'low-signal',
      JSON.stringify(decision),
      conversationId,
    ],
  );
  (deps.save ?? saveDatabase)();
}
