import type { OutcomeType } from '@chatcrystal/shared';

type Candidate = {
  project_key?: string;
  outcome_type: OutcomeType;
  summary: string;
  root_cause?: string;
  resolution?: string;
  error_signatures?: string[];
};

type ExistingMemory = {
  note_id: number;
  project_key?: string;
  outcome_type?: string;
  root_cause?: string;
  resolution?: string;
  error_signatures?: string[];
};

function normalizeOptionalText(input?: string) {
  const trimmed = input?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

export function decideWritebackAction(
  candidate: Candidate,
  existing: ExistingMemory[],
) {
  const normalizedSummary = candidate.summary.trim().toLowerCase();
  const lowSignal =
    normalizedSummary.length < 24 || normalizedSummary === 'fixed it.';
  const noKnowledgeDelta =
    !candidate.root_cause?.trim() &&
    !candidate.resolution?.trim() &&
    !(candidate.error_signatures?.length);

  if (lowSignal || noKnowledgeDelta) {
    return {
      decision: 'skipped' as const,
      reason: 'low-signal' as const,
      target_note_id: null,
    };
  }

  const matching = existing.find((note) => {
    const sameProject =
      Boolean(note.project_key) && note.project_key === candidate.project_key;
    const sameRootCause =
      Boolean(note.root_cause?.trim()) &&
      normalizeOptionalText(note.root_cause) ===
        normalizeOptionalText(candidate.root_cause);
    const candidateResolution = normalizeOptionalText(candidate.resolution);
    const existingResolution = normalizeOptionalText(note.resolution);
    const sameResolution =
      candidateResolution && existingResolution
        ? candidateResolution === existingResolution
        : !candidateResolution && !existingResolution;
    const overlappingSignature = (note.error_signatures ?? []).some((value) =>
      (candidate.error_signatures ?? []).includes(value),
    );

    return Boolean(
      sameProject &&
        sameRootCause &&
        sameResolution &&
        overlappingSignature,
    );
  });

  if (matching) {
    return {
      decision: 'merged' as const,
      reason: 'merged-into-existing-memory' as const,
      target_note_id: matching.note_id,
    };
  }

  return {
    decision: 'created' as const,
    reason: 'created-new-memory' as const,
    target_note_id: null,
  };
}
