# Experience Quality Gate

English | [简体中文](EXPERIENCE_GATE.zh-CN.md)

The experience quality gate keeps ChatCrystal focused on reusable experience assets instead of raw conversation summaries.

## Goal

ChatCrystal should preserve conversations that contain:

- problem-solving process
- multi-step reasoning or analysis
- decisions and tradeoffs
- verified outcomes
- reusable patterns

It should filter or downgrade:

- single-turn informational Q&A
- low-density approval messages
- raw logs without analysis
- abandoned brainstorms
- implementation notes without verification
- content with no durable conclusion

## Decision Model

The gate combines:

1. **Lexical signals** extracted from conversation messages.
2. **Prefilter rules** that reject obvious low-signal cases before an LLM judge is needed.
3. **Structured judge dimensions** for candidates that pass prefilter:
   - `problem_clarity`
   - `process_depth`
   - `decision_value`
   - `outcome_closure`
   - `reuse_potential`
4. **Core enforcement** during both summarization and MCP writeback.

The gate is deliberately hybrid: deterministic rules catch simple cases, while structured scoring handles dense or nuanced experience candidates.

## Persistence

Rejected conversations do not create notes. Audit details are stored on the conversation row:

- `experience_score`
- `experience_gate_reason`
- `experience_gate_details`
- `status = filtered`

This makes filtering reviewable and keeps future retry workflows possible.

## Offline Calibration

Run the calibration suite:

```bash
npm run eval:experience -w server
```

The default sample set lives at:

```text
server/src/services/experience/eval-samples.json
```

The current default set contains 37 calibration cases and must pass with no false accepts or false rejects.

## Sample Provenance and Privacy

The default sample set is declared as:

```json
{
  "origin": "synthetic_calibration_cases",
  "contains_real_user_data": false
}
```

These samples are hand-authored calibration cases. They are not copied from a local ChatCrystal database or raw private conversation logs.

Privacy tests reject common sensitive patterns, including:

- absolute local user paths
- personal user names
- email addresses
- private IP ranges and loopback literals
- secret-like tokens
- private key material

When adding real examples later, use desensitized samples and update the provenance metadata intentionally.

## Adding Calibration Cases

Add a sample when the gate makes a meaningful false accept or false reject.

Each useful sample should include:

- `id`: stable kebab-case identifier
- `label`: human-readable scenario
- `expected_decision`: `accept` or `reject`
- `messages`: minimal conversation evidence
- `judge_dimensions`: required when the sample should pass prefilter
- `notes`: why the case matters

Prefer small high-signal cases over large pasted transcripts.

## Review Workflow

The next product step should make gate decisions reviewable:

1. Surface filtered conversations and reasons in UI or CLI.
2. Let a user mark a case as "should keep" or "correctly filtered".
3. Feed false accepts and false rejects back into the calibration set.
4. Re-run `npm run eval:experience -w server` before changing thresholds.

The quality gate should evolve from real review outcomes, not intuition alone.

