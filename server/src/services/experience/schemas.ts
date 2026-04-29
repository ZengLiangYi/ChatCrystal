import { z } from 'zod';

export const ExperienceDimensionsSchema = z.object({
  problem_clarity: z.number().min(0).max(20),
  process_depth: z.number().min(0).max(20),
  decision_value: z.number().min(0).max(20),
  outcome_closure: z.number().min(0).max(20),
  reuse_potential: z.number().min(0).max(20),
});

export const ExperienceGateDecisionSchema = z.object({
  decision: z.enum(['accept', 'reject', 'borderline']),
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  missing_signals: z.array(z.string()),
  dimensions: ExperienceDimensionsSchema,
});

export type ExperienceDimensions = z.infer<typeof ExperienceDimensionsSchema>;
export type ExperienceGateDecision = z.infer<
  typeof ExperienceGateDecisionSchema
>;

export type ExperienceSignalMessage = {
  type: string;
  content: string;
  has_tool_use?: number | boolean | null;
  has_code?: number | boolean | null;
};

export type ExperienceSignals = {
  effective_turns: number;
  content_chars: number;
  has_problem_signal: boolean;
  has_error_signal: boolean;
  has_code_signal: boolean;
  has_process_signal: boolean;
  has_decision_signal: boolean;
  has_outcome_signal: boolean;
  has_reuse_signal: boolean;
  has_strong_single_turn_signal: boolean;
};

export const ZERO_DIMENSIONS: ExperienceDimensions = {
  problem_clarity: 0,
  process_depth: 0,
  decision_value: 0,
  outcome_closure: 0,
  reuse_potential: 0,
};
