import type { MaterializedTaskMemoryNote } from '@chatcrystal/shared';

type ValidationMode = 'auto' | 'manual';

export type NoteQualityDecision = {
  accepted: boolean;
  reason: 'note-quality-ok' | 'manual-note-quality-warning' | 'low-note-quality';
  warnings: string[];
};

function compactLength(value: string) {
  return value.replace(/\s+/g, '').length;
}

function hasMeaningfulText(value: string, minLatin = 24, minCjk = 18) {
  const text = value.trim();
  if (!text) return false;
  const hasCjk = /[\u3400-\u9fff]/.test(text);
  return compactLength(text) >= (hasCjk ? minCjk : minLatin);
}

function isGenericTitle(title: string) {
  return /^(task|memory|note|update|summary|investigate|check|fix)$/i.test(title.trim());
}

function joined(note: MaterializedTaskMemoryNote) {
  return [
    note.title,
    note.summary,
    ...note.key_conclusions,
  ].join('\n').toLowerCase();
}

function hasDurableReusableSignal(note: MaterializedTaskMemoryNote) {
  if (isMostlyOneOffStatus(note)) return false;
  const payload = note.raw_payload;
  const conclusions = note.key_conclusions.join('\n').toLowerCase();
  const hasStructuredSignal =
    Boolean(payload.root_cause && payload.resolution) ||
    Boolean(payload.reusable_patterns?.some((item) => hasMeaningfulText(item))) ||
    Boolean(payload.pitfalls?.some((item) => hasMeaningfulText(item))) ||
    Boolean(payload.decisions?.some((item) => hasMeaningfulText(item))) ||
    Boolean(payload.error_signatures?.length && (payload.root_cause || payload.resolution));
  const hasVisibleSignal =
    /root cause:|resolution:|pitfall:|pattern:|decision:|error signature:/i.test(conclusions);
  return hasStructuredSignal && hasVisibleSignal;
}

function isMostlyOneOffStatus(note: MaterializedTaskMemoryNote) {
  const text = joined(note);
  const statusWords = [
    'version',
    'status',
    'checked',
    'current',
    'package',
    'npm link',
    'dist',
    'local',
    'environment',
    '配置',
    '版本',
    '检查',
    '状态',
  ];
  const durableWords = [
    'root cause',
    'resolution',
    'pitfall',
    'avoid',
    'decision',
    'rationale',
    'reuse',
    'transferable',
    '原因',
    '解决',
    '避免',
    '模式',
    '决策',
  ];
  const statusHits = statusWords.filter((word) => text.includes(word)).length;
  const durableHits = durableWords.filter((word) => text.includes(word)).length;
  return statusHits >= 3 && durableHits === 0;
}

export function validateMaterializedNoteQuality(
  note: MaterializedTaskMemoryNote,
  options: { mode: ValidationMode },
): NoteQualityDecision {
  const warnings: string[] = [];

  if (!hasMeaningfulText(note.title, 10, 6) || isGenericTitle(note.title)) {
    warnings.push('title');
  }
  if (!hasMeaningfulText(note.summary)) {
    warnings.push('summary');
  }
  if (!note.key_conclusions.some((item) => hasMeaningfulText(item, 16, 10))) {
    warnings.push('key_conclusions');
  }
  if (!hasDurableReusableSignal(note)) {
    warnings.push('durable_reusable_lesson');
  }
  if (isMostlyOneOffStatus(note)) {
    warnings.push('one_off_status');
  }

  const manualReadable =
    !warnings.includes('title') &&
    !warnings.includes('summary') &&
    !warnings.includes('key_conclusions');

  if (warnings.length === 0) {
    return { accepted: true, reason: 'note-quality-ok', warnings: [] };
  }
  if (options.mode === 'manual' && manualReadable) {
    return {
      accepted: true,
      reason: 'manual-note-quality-warning',
      warnings,
    };
  }
  return { accepted: false, reason: 'low-note-quality', warnings };
}
