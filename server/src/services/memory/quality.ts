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

function isPlaceholderText(value: string) {
  return /\b(unknown|n\/a|not sure|todo|tbd|appropriate change|fix the issue|task needed investigation|expected behavior|task works correctly|expected pattern)\b/i
    .test(value);
}

function hasNonPlaceholderMeaningfulText(value: string, minLatin = 24, minCjk = 18) {
  return hasMeaningfulText(value, minLatin, minCjk) && !isPlaceholderText(value);
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

function hasWord(text: string, word: string) {
  if (/[\u3400-\u9fff]/.test(word)) {
    return text.includes(word);
  }
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
}

function hasConcreteTransferableAction(value: string) {
  const text = value.toLowerCase();
  const concreteActionWords = [
    'add',
    'block',
    'cache',
    'collapse',
    'configure',
    'compare',
    'comparing',
    'debounce',
    'deduplicate',
    'defer',
    'enqueue',
    'extract',
    'filter',
    'gate',
    'group',
    'index',
    'migrate',
    'normalize',
    'parse',
    'pin',
    'prune',
    'rebuild',
    'remove',
    'replace',
    'retry',
    'sanitize',
    'set',
    'truncate',
    'validate',
    'wait',
    'wait for',
    'wrap',
    '避免',
    '防止',
    '复用',
  ];
  return concreteActionWords.some((word) => hasWord(text, word));
}

function isVagueGenericLesson(value: string) {
  const text = value.toLowerCase();
  const hasBoilerplateClaim =
    /\bvalidation is important for correctness\b/.test(text) ||
    /\bcorrectness matters\b/.test(text) ||
    /\bcorrect pattern\b/.test(text) ||
    /\bbecause\b.+\bis important for correctness\b/.test(text) ||
    /\bshould\b.+\bbecause correctness\b/.test(text) ||
    /\bshould\b.+\bcorrect pattern\b/.test(text) ||
    /\bthe (pattern|task) should\b/.test(text) ||
    /\bshould validate\b.+\bbecause\b/.test(text) ||
    /\bexpected pattern\b/.test(text);
  const hasGenericTerms =
    /\b(the task|this task|the pattern|the implementation|implementation behavior|expected behavior|expected pattern|values?|input|correctness|going forward)\b/.test(text);
  return hasBoilerplateClaim || (hasGenericTerms && !hasSpecificObject(text));
}

function isGenericStatusAction(value: string) {
  const text = value.toLowerCase();
  const hasGenericAction = ['validate', 'investigate', 'check', 'checked', 'persist', 'record', 'recorded']
    .some((word) => hasWord(text, word));
  const hasStatusSubject =
    /\b(node_env|env|environment|deployment|production|status|local|package version|version)\b/i
      .test(text);
  const hasGenericRationale = /\b(expected|should|because|pattern)\b/i.test(text);
  return hasGenericAction && hasStatusSubject && hasGenericRationale;
}

function hasSpecificObject(value: string) {
  return /\b(server|readiness|client calls?|request setup|package version|dist output|release checks?|node_env|data_dir|data directory|entrypoint|startup|npm link|sqlite|database|tags?|note_tags|embedding|jsonl|cursor|codex|claude|mcp|api|url|port|path|config|environment|schema|queue|watcher|electron|window state)\b|\b[a-z0-9]+_[a-z0-9_]+\b|[a-z]:\\|\/[\w.-]+|[\u3400-\u9fff]/i
    .test(value.toLowerCase());
}

function hasConcreteTransferableText(value: string) {
  return (
    hasNonPlaceholderMeaningfulText(value) &&
    hasConcreteTransferableAction(value) &&
    hasSpecificObject(value) &&
    !isGenericStatusAction(value) &&
    !isVagueGenericLesson(value)
  );
}

function hasDurableReusableSignal(note: MaterializedTaskMemoryNote) {
  if (isMostlyOneOffStatus(note)) return false;
  const payload = note.raw_payload;
  const conclusions = note.key_conclusions.join('\n').toLowerCase();
  const hasMeaningfulRootCause = Boolean(
    payload.root_cause &&
    hasNonPlaceholderMeaningfulText(payload.root_cause) &&
    hasSpecificObject(payload.root_cause) &&
    !isGenericStatusAction(payload.root_cause) &&
    !isVagueGenericLesson(payload.root_cause),
  );
  const hasMeaningfulResolution = Boolean(
    payload.resolution &&
    hasConcreteTransferableText(payload.resolution),
  );
  const hasStructuredSignal =
    (hasMeaningfulRootCause && hasMeaningfulResolution) ||
    Boolean(payload.reusable_patterns?.some((item) => hasConcreteTransferableText(item))) ||
    Boolean(payload.pitfalls?.some((item) => hasConcreteTransferableText(item))) ||
    Boolean(payload.decisions?.some((item) => hasConcreteTransferableText(item)));
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
    'env',
    'node_env',
    'deployment',
    'production',
    '配置',
    '版本',
    '检查',
    '状态',
  ];
  const statusHits = statusWords.filter((word) => text.includes(word)).length;
  return statusHits >= 3 && (!hasConcreteTransferableAction(text) || isGenericStatusAction(text));
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
