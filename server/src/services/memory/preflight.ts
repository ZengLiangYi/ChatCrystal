import type {
  MaterializedTaskMemoryNote,
  ValidateTaskMemoryResponse,
} from '@chatcrystal/shared';
import type { ExperienceGateDecision } from '../experience/schemas.js';
import { validateStructuredMemoryCandidate } from '../experience/gate.js';
import { materializeTaskMemory } from './materialize.js';
import { validateMaterializedNoteQuality } from './quality.js';
import { parseValidateTaskMemoryRequest } from './schemas.js';

type ParsedValidateTaskMemoryRequest = ReturnType<
  typeof parseValidateTaskMemoryRequest
>;
type StructuredMemoryCandidate = ParsedValidateTaskMemoryRequest['memory'];
type StructuredMemoryGateDecision =
  Pick<ExperienceGateDecision, 'reasons' | 'missing_signals'> | null;
type StructuredMemoryValidator = (
  memory: StructuredMemoryCandidate,
) => StructuredMemoryGateDecision;
type NoteQualityValidator = (
  note: MaterializedTaskMemoryNote,
  options: { mode: ParsedValidateTaskMemoryRequest['mode'] },
) => {
  accepted: boolean;
  reason: string;
  warnings: string[];
};

export function validateTaskMemory(
  input: unknown,
  deps: {
    validateStructuredMemoryCandidate?: StructuredMemoryValidator;
    validateMaterializedNoteQuality?: NoteQualityValidator;
  } = {},
): ValidateTaskMemoryResponse {
  const request = parseValidateTaskMemoryRequest(input);
  const materialized = materializeTaskMemory(request);
  const validateMemory =
    deps.validateStructuredMemoryCandidate ?? validateStructuredMemoryCandidate;
  const structuredDecision = validateMemory(request.memory);

  if (structuredDecision) {
    return {
      mode: request.mode,
      accepted: false,
      decision: 'skipped',
      reason: structuredDecision.reasons[0] ?? 'low-signal',
      warnings: structuredDecision.missing_signals,
      materialized_note: materialized,
    };
  }

  const qualityValidator =
    deps.validateMaterializedNoteQuality ?? validateMaterializedNoteQuality;
  const qualityDecision = qualityValidator(materialized, { mode: request.mode });

  return {
    mode: request.mode,
    accepted: qualityDecision.accepted,
    decision: qualityDecision.accepted ? 'accepted' : 'skipped',
    reason: qualityDecision.reason,
    warnings: qualityDecision.warnings,
    materialized_note: materialized,
  };
}
