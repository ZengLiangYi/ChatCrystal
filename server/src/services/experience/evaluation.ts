import { readFileSync } from 'node:fs';
import type {
  ExperienceDimensions,
  ExperienceGateDecision,
  ExperienceSignalMessage,
} from './schemas.js';
import {
  combineConversationGateDecision,
  prefilterConversationExperience,
} from './gate.js';
import { extractExperienceSignals } from './signals.js';

export type ExperienceGateEvalSample = {
  id: string;
  label: string;
  expected_decision: ExperienceGateDecision['decision'];
  messages: ExperienceSignalMessage[];
  judge_dimensions?: ExperienceDimensions;
  notes?: string;
};

export type ExperienceGateEvalDataset = {
  schema_version: 1;
  provenance: {
    origin: 'synthetic_calibration_cases' | 'desensitized_real_cases';
    contains_real_user_data: boolean;
    sanitization: string[];
  };
  samples: ExperienceGateEvalSample[];
};

export type ExperienceGateEvalResult = {
  id: string;
  label: string;
  expected_decision: ExperienceGateDecision['decision'];
  actual_decision: ExperienceGateDecision['decision'];
  passed: boolean;
  stage: 'prefilter' | 'judge';
  score: number;
  reasons: string[];
  missing_signals: string[];
};

export type ExperienceGateEvalSummary = {
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
  results: ExperienceGateEvalResult[];
  false_accepts: ExperienceGateEvalResult[];
  false_rejects: ExperienceGateEvalResult[];
};

export function evaluateExperienceGateSample(
  sample: ExperienceGateEvalSample,
): ExperienceGateEvalResult {
  const signals = extractExperienceSignals(sample.messages);
  const prefilter = prefilterConversationExperience(signals);
  const decision = prefilter ?? (() => {
    if (!sample.judge_dimensions) {
      throw new Error(
        `Sample "${sample.id}" passed prefilter but has no judge_dimensions`,
      );
    }
    return combineConversationGateDecision(signals, sample.judge_dimensions);
  })();

  return {
    id: sample.id,
    label: sample.label,
    expected_decision: sample.expected_decision,
    actual_decision: decision.decision,
    passed: decision.decision === sample.expected_decision,
    stage: prefilter ? 'prefilter' : 'judge',
    score: decision.score,
    reasons: decision.reasons,
    missing_signals: decision.missing_signals,
  };
}

export function evaluateExperienceGateSamples(
  samples: ExperienceGateEvalSample[],
): ExperienceGateEvalSummary {
  const results = samples.map(evaluateExperienceGateSample);
  const passed = results.filter((result) => result.passed).length;
  const falseAccepts = results.filter(
    (result) =>
      result.actual_decision === 'accept' &&
      result.expected_decision !== 'accept',
  );
  const falseRejects = results.filter(
    (result) =>
      result.actual_decision !== 'accept' &&
      result.expected_decision === 'accept',
  );

  return {
    total: samples.length,
    passed,
    failed: samples.length - passed,
    pass_rate: samples.length === 0 ? 0 : passed / samples.length,
    results,
    false_accepts: falseAccepts,
    false_rejects: falseRejects,
  };
}

export function formatExperienceGateEvalReport(
  summary: ExperienceGateEvalSummary,
): string {
  const percent = Math.round(summary.pass_rate * 100);
  const failedRows = summary.results
    .filter((result) => !result.passed)
    .map(
      (result) =>
        `- ${result.id}: expected ${result.expected_decision}, got ${result.actual_decision} (${result.reasons.join(', ')})`,
    );

  return [
    'Experience Gate Evaluation',
    `Passed: ${summary.passed}/${summary.total} (${percent}%)`,
    `False accepts: ${summary.false_accepts.length}`,
    `False rejects: ${summary.false_rejects.length}`,
    ...(failedRows.length ? ['', 'Failures:', ...failedRows] : []),
  ].join('\n');
}

export function loadExperienceGateEvalSamples(
  filePath: string,
): ExperienceGateEvalSample[] {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  if (Array.isArray(parsed)) {
    return parsed as ExperienceGateEvalSample[];
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    'samples' in parsed &&
    Array.isArray(parsed.samples)
  ) {
    return parsed.samples as ExperienceGateEvalSample[];
  }
  throw new Error(
    'Experience gate eval sample file must contain an array or dataset object',
  );
}

export function loadExperienceGateEvalDataset(
  filePath: string,
): ExperienceGateEvalDataset {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  if (
    parsed &&
    typeof parsed === 'object' &&
    'schema_version' in parsed &&
    parsed.schema_version === 1 &&
    'provenance' in parsed &&
    parsed.provenance &&
    typeof parsed.provenance === 'object' &&
    'samples' in parsed &&
    Array.isArray(parsed.samples)
  ) {
    return parsed as ExperienceGateEvalDataset;
  }
  if (Array.isArray(parsed)) {
    return {
      schema_version: 1,
      provenance: {
        origin: 'synthetic_calibration_cases',
        contains_real_user_data: false,
        sanitization: ['Legacy array fixture; provenance was not explicit.'],
      },
      samples: parsed as ExperienceGateEvalSample[],
    };
  }
  throw new Error('Experience gate eval dataset file is invalid');
}
