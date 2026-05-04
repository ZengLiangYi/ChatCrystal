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
  return /\b(unknown|n\/a|not sure|todo|tbd|appropriate change|fix the issue|task needed investigation|expected behavior|task works correctly|expected pattern|was wrong)\b/i
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
    'import',
    'index',
    'initialize',
    'load',
    'migrate',
    'normalize',
    'parse',
    'pin',
    'prune',
    'rebuild',
    'regenerate',
    'register',
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
    /\bright value for reliability\b/.test(text) ||
    /\b(for|so|because)\b.+\b(reliable|reliability|correctness)\b/.test(text) ||
    /\bbecause\b.+\bis important for correctness\b/.test(text) ||
    /\bshould\b.+\bbecause correctness\b/.test(text) ||
    /\bshould\b.+\bcorrect pattern\b/.test(text) ||
    /\bthe (pattern|task) should\b/.test(text) ||
    /\bshould validate\b.+\bbecause\b/.test(text) ||
    /\bbecause it should work\b/.test(text) ||
    /\bit should work correctly\b/.test(text) ||
    /\bshould work\b/.test(text) ||
    /\bshould work correctly\b/.test(text) ||
    /\bso\b.+\bworks?\b/.test(text) ||
    /\bso the server works\b/.test(text) ||
    /\badd api config\b/.test(text) ||
    /\bcache server config\b/.test(text) ||
    /\bbetter approach\b/.test(text) ||
    /\bhandle\b.+\bproperly\b/.test(text) ||
    /\bexpected pattern\b/.test(text);
  const hasGenericTerms =
    /\b(the task|this task|the pattern|the implementation|implementation behavior|expected behavior|expected pattern|values?|input|correctness|going forward)\b/.test(text);
  return hasBoilerplateClaim || (hasGenericTerms && !hasSpecificObject(text));
}

function isVagueGenericFixClaim(value: string) {
  const text = value.toLowerCase();
  return (
    /\b(unknown|n\/a|not sure|todo|tbd|appropriate change|fix the issue|task needed investigation|expected behavior|task works correctly|expected pattern|was wrong)\b/i
      .test(text) ||
    /\bvalidation is important for correctness\b/.test(text) ||
    /\bcorrectness matters\b/.test(text) ||
    /\bcorrect pattern\b/.test(text) ||
    /\bright value for reliability\b/.test(text) ||
    /\bbecause\b.+\bis important for correctness\b/.test(text) ||
    /\bshould\b.+\bbecause correctness\b/.test(text) ||
    /\bshould\b.+\bcorrect pattern\b/.test(text) ||
    /\bbecause it should work\b/.test(text) ||
    /\bit should work correctly\b/.test(text) ||
    /\bshould work\b/.test(text) ||
    /\bshould work correctly\b/.test(text) ||
    /\bso\b.+\bworks?\b/.test(text) ||
    /\badd api config\b/.test(text) ||
    /\bcache server config\b/.test(text) ||
    /\bbetter approach\b/.test(text) ||
    /\bhandle\b.+\bproperly\b/.test(text)
  );
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
  return hasSpecificEvidence(value) || hasConcreteMechanism(value);
}

function hasSpecificEvidence(value: string) {
  const text = value.toLowerCase();
  return (
    /\b(data_dir|node_env|econrefused|note_tags|chatcrystal\.db|port|source_run_key|foreign_keys)\b|\/api\/[\w/-]+|\b[a-z0-9]+_[a-z0-9_]+\b|[a-z]:\\|\/[\w.-]+|[\u3400-\u9fff]/i
      .test(text) ||
    hasHttpFailureSignal(text) ||
    /\b(api requests?|fastify readiness|server readiness|request setup|package metadata|package version|dist output|generated dist output|data directory|electron server|server entrypoint|client calls?)\b/i
      .test(text)
  );
}

function hasConcreteMechanism(value: string) {
  const text = value.toLowerCase();
  const hasTimingOrder =
    /\b(before|after|until|when)\b.+\b(import|importing|issue|issuing|request|requests|setup|ready|readiness|server|startup|data_dir|entrypoint|metadata|dist|compare|comparing)\b/i
      .test(text) ||
    /\b(import|importing|issue|issuing|request|requests|setup|ready|readiness|server|startup|data_dir|entrypoint|metadata|dist|compare|comparing)\b.+\b(before|after|until|when)\b/i
      .test(text);
  const hasRaceReadiness =
    /\b(race|raced|readiness|startup|econrefused)\b.+\b(request|requests|ready|server|client calls?|fastify)\b/i
      .test(text) ||
    /\b(request|requests|ready|server|client calls?|fastify)\b.+\b(race|raced|readiness|startup|econrefused)\b/i
      .test(text);
  const hasPackageDistFlow =
    /\b(parse|parsing|normalize|normalizing|compare|comparing)\b.+\b(package metadata|package version|generated dist|dist output)\b/i
      .test(text) ||
    /\b(package metadata|package version|generated dist|dist output)\b.+\b(diverged|diverge|parse|parsing|normalize|normalizing|compare|comparing)\b/i
      .test(text);
  const hasDataDirFallback = hasDefaultDataDirectoryConsequence(text);
  const hasRelationalCleanup =
    /\b(foreign_keys|orphan rows|cascade|nulling|resets foreign_keys)\b/i.test(text);
  const hasDedupeKey =
    /\b(dedupe|deduplicate)\b.+\b(source_run_key|key)\b/i.test(text);
  const hasRequestFailureOrdering =
    hasHttpFailureSignal(text) &&
    (
      /\b(ran after|after request setup|before issuing|before request setup|registration ran after)\b/i.test(text) ||
      hasTimingOrder
    );
  return (
    hasTimingOrder ||
    hasRaceReadiness ||
    hasPackageDistFlow ||
    hasDataDirFallback ||
    hasRelationalCleanup ||
    hasDedupeKey ||
    hasRequestFailureOrdering
  );
}

function hasConcreteTransferableText(value: string) {
  if (hasPackageDistRootCauseShape(value) && !hasPackageItemSignal(value)) return false;
  return (
    hasNonPlaceholderMeaningfulText(value) &&
    hasConcreteTransferableAction(value) &&
    hasSpecificEvidence(value) &&
    hasConcreteMechanism(value) &&
    hasFailureOrConsequenceSignal(value) &&
    !isExistenceOnlyClaim(value) &&
    !isGenericStatusAction(value) &&
    !isVagueGenericLesson(value)
  );
}

function hasPackageItemSignal(value: string) {
  const text = value.toLowerCase();
  if (/\b(current|local|status checks?|checked)\b/i.test(text)) return false;
  return hasPackageDistRootCauseSignal(text);
}

function hasFailureOrConsequenceSignal(value: string) {
  return (
    /\b(race|raced|orphan|dedupe|deduplicate|stale dist|dist diverge|dist diverged|diverge|diverged|econrefused|readiness issue|startup race|invalid note_tags|foreign_keys|cascade|nulling|source_run_key collision)\b/i
      .test(value) ||
    hasDefaultDataDirectoryConsequence(value) ||
    hasHttpFailureSignal(value)
  );
}

function hasStrongRootCauseSignal(value: string) {
  if (hasPackageDistRootCauseShape(value)) return hasPackageDistRootCauseSignal(value);
  if (isExistenceOnlyClaim(value)) return false;
  if (isPackageArtifactObservationClaim(value)) return false;
  if (hasGenericRootCauseRationale(value)) return false;
  if (isWeakRootCauseClaim(value)) return false;
  if (hasHttpFailureSignal(value)) return hasConcreteHttpRootCauseSignal(value);
  return (
    hasFailureOrConsequenceSignal(value) ||
    /\b(because|so)\b.+\b(ran before|ran after|returned http [45]\d\d|returned [45]\d\d|http [45]\d\d|imported.+before|used the default data directory|version parsing.+(inconsistent|mismatch|wrong|stale|diverged|diverge)|raced|race|econrefused)\b/i
      .test(value) ||
    /\b(ran before|ran after|returned http [45]\d\d|returned [45]\d\d|http [45]\d\d|imported.+before|used the default data directory|version parsing.+(inconsistent|mismatch|wrong|stale|diverged|diverge)|raced|race|econrefused)\b.+\b(because|so)\b/i
      .test(value)
  );
}

function hasPackageDistRootCauseShape(value: string) {
  return /\b(package metadata|package version|version parsing|package version parsing|package normalization|version normalization)\b/i
    .test(value) &&
    /\b(generated dist output|dist output|dist comparison|dist comparisons|dist)\b/i
      .test(value);
}

function hasPackageDistRootCauseSignal(value: string) {
  const text = value.toLowerCase();
  const packageMechanism = '(?:version parsing|parsing|version normalization|normalization|normalize|normalized|different formats|inconsistent normalization|comparison|comparing|version bump|bumping package metadata|dist generation|generated dist output)';
  const packageOutcome = '(?:diverged|divergence|mismatch|stale(?: package metadata| output| dist)?|wrong comparison|comparison failure|dist comparisons? unreliable|differ(?:ed|s)? from package metadata|differ(?:ed|s)? from package version)';
  const hasExplicitCausality = hasExplicitPackageCausality(text);
  const hasPositiveSignal =
    new RegExp(`\\b(package metadata|package version|generated dist output|dist output)\\b.+\\b${packageOutcome}\\b.+\\bbecause\\b.+\\b${packageMechanism}\\b.+\\b(inconsistent|different formats|mismatch|wrong|stale)\\b`, 'i')
      .test(text) ||
    new RegExp(`\\b(generated dist output|dist output)\\b.+\\b${packageOutcome}\\b.+\\b(package metadata|package version)\\b.+\\bbecause\\b.+\\b${packageMechanism}\\b.+\\b(inconsistent|different formats|mismatch|wrong|stale)\\b`, 'i')
      .test(text) ||
    new RegExp(`\\b(inconsistent|different formats)\\b.+\\b(version parsing|package version parsing|version normalization|package normalization)\\b.+\\b(generated dist output|dist output|dist comparisons?|dist)\\b.+\\b${packageOutcome}\\b`, 'i')
      .test(text) ||
    /\b(inconsistent|different formats)\b.+\b(version parsing|package version parsing|version normalization|package normalization)\b.+\bdist comparisons?\b.+\bunreliable\b/i
      .test(text) ||
    /\b(generated dist output|dist output)\b.+\bstale package metadata\b.+\bbecause\b.+\bversion bump\b.+\bran after\b.+\bdist generation\b/i
      .test(text) ||
    /\b(generated dist output|dist output)\b.+\bstale\b.+\bbecause\b.+\bdist generation\b.+\bran before\b.+\b(package metadata )?version bump\b/i
      .test(text);
  if ((isPackageArtifactObservationClaim(text) || isExistenceOnlyClaim(text)) && !hasExplicitCausality) {
    return false;
  }
  if (hasPositiveSignal || hasExplicitCausality) return true;
  if (isPackageArtifactObservationClaim(text) || isExistenceOnlyClaim(text)) return false;
  return false;
}

function hasExplicitPackageCausality(value: string) {
  const text = value.toLowerCase();
  return (
    /\b(diverged|divergence|mismatch|stale(?: package metadata| output| dist)?|wrong comparison|comparison failure|dist comparisons? unreliable|differ(?:ed|s)? from package metadata|differ(?:ed|s)? from package version)\b.+\bbecause\b.+\b(version parsing|parsing|version normalization|normalization|normalize|normalized|different formats|inconsistent normalization|comparison|comparing)\b/i
      .test(text) ||
    /\b(version parsing|parsing|version normalization|normalization|normalize|normalized|different formats|inconsistent normalization|comparison|comparing)\b.+\b(caused|produced|led to|made)\b.+\b(diverged|divergence|mismatch|stale(?: package metadata| output| dist)?|wrong comparison|comparison failure|dist comparisons? unreliable|differ(?:ed|s)? from package metadata|differ(?:ed|s)? from package version)\b/i
      .test(text)
  );
}

function isExistenceOnlyClaim(value: string) {
  const text = value.toLowerCase();
  const hasExistencePhrase =
    /\b(existed|exists|was present|were present|present during|is available|was available|on disk|is on disk|was on disk|was there|were there|there was|there were|was found|were found|was included|were included|was located|were located|was listed|was detected|were detected|was observed|were observed|was seen|were seen|was discovered|were discovered|appeared|showed up)\b/
      .test(text);
  return hasExistencePhrase && !hasDefaultDataDirectoryConsequence(text);
}

function isPackageArtifactObservationClaim(value: string) {
  const text = value.toLowerCase();
  const packageArtifact = '(?:package metadata|package version|package artifact|package artifacts)';
  const observationVerb = '(?:exist(?:ed|s)?|present|available|found|included|located|listed|detect(?:ed)?|observ(?:ed)?|saw|seen|discover(?:ed)?|appeared|showed up|was there|were there)';
  const activeObservation = new RegExp(`\\b${observationVerb}\\b(?:\\s+\\w+){0,4}\\s+${packageArtifact}\\b`, 'i');
  const artifactObservation = new RegExp(`\\b${packageArtifact}\\b(?:\\s+\\w+){0,4}\\s+${observationVerb}\\b`, 'i');
  return activeObservation.test(text) || artifactObservation.test(text);
}

function hasDefaultDataDirectoryConsequence(value: string) {
  return /\b(prevents?|preventing|avoid|avoids|avoiding)\b.+\b(fallback\b.+\bdefault data directory|default data directory fallback)\b/i
    .test(value) ||
    /\bfell back\b.+\bdefault data directory\b/i.test(value) ||
    /\bused the default data directory\b/i.test(value);
}

function isWeakRootCauseClaim(value: string) {
  const text = value.toLowerCase();
  const hasWeakPhrase =
    /\b(not correct before|was not correct|not configured correctly|was wrong|incomplete|not proper|not properly|properly)\b/
      .test(text);
  return hasWeakPhrase && !hasConcreteRootCauseMechanism(text);
}

function hasConcreteRootCauseMechanism(value: string) {
  const text = value.toLowerCase();
  const hasRegistrationOrdering =
    /(?:\/api\/[\w/-]+|route|registration).+\b(was registered after request setup|registration ran after request setup|registered after request setup|ran after request setup)\b/i
      .test(text);
  const hasConfigOrdering =
    /\b(config|node_env config)\b.+\b(imported|was imported)\b.+\b(node_env\s+)?after request setup\b/i
      .test(text) ||
    /\bnode_env\b.+\bconfig\b.+\b(imported|was imported)\b.+\bafter request setup\b/i
      .test(text) ||
    /\bimported\b.+\bnode_env\b.+\bafter request setup\b/i
      .test(text);
  const hasMissingRouteMechanism =
    /\b(route|\/api\/[\w/-]+)\b.+\b(missing|unregistered|was missing|was unregistered)\b.+\b(before request setup|before api requests?|api requests?|request setup)\b/i
      .test(text) ||
    /\b(route|\/api\/[\w/-]+)\b.+\b(was not registered|not registered)\b.+\b(before request setup|before api requests?|api requests?|request setup)\b/i
      .test(text) ||
    /\b(missing|unregistered)\b.+\b(route|\/api\/[\w/-]+)\b.+\b(before request setup|before api requests?|api requests?|request setup)\b/i
      .test(text);
  return hasRegistrationOrdering || hasConfigOrdering || hasMissingRouteMechanism;
}

function hasGenericRootCauseRationale(value: string) {
  return /\bbecause\b.+\b(correctness|reliability|quality|it)\b.+\b(mattered|was important|is important)\b/i
    .test(value);
}

function hasConcreteHttpRootCauseSignal(value: string) {
  return hasConcreteRootCauseMechanism(value);
}

function hasHttpFailureSignal(value: string) {
  const text = value.toLowerCase();
  const hasHttpError = /\b(http\s*)?[45]\d\d\b/.test(text);
  const hasFailureContext = /\b(api|request|requests|route|http|returned|failed|threw|error)\b/.test(text);
  return hasHttpError && hasFailureContext && !/\b(status\s*)?2\d\d\b/.test(text);
}

function hasActionableResolution(value: string) {
  return (
    hasNonPlaceholderMeaningfulText(value) &&
    hasConcreteTransferableAction(value) &&
    hasSpecificObject(value) &&
    hasConcreteMechanism(value) &&
    !isGenericResolutionClaim(value) &&
    !isGenericStatusAction(value) &&
    !isVagueGenericFixClaim(value)
  );
}

function isGenericResolutionClaim(value: string) {
  return /\b(add|use|apply)\b.+\bvalidation\b.+\b(prevent|avoid)\b.+\b(future failures?|failures?|issues?)\b/i
    .test(value);
}

function hasDurableFixSignal(note: MaterializedTaskMemoryNote) {
  const rootCause = note.raw_payload.root_cause;
  const resolution = note.raw_payload.resolution;
  if (!rootCause || !resolution) return false;

  const combined = `${rootCause}\n${resolution}`;
  return (
    hasNonPlaceholderMeaningfulText(rootCause) &&
    hasStrongRootCauseSignal(rootCause) &&
    hasActionableResolution(resolution) &&
    hasSpecificEvidence(combined) &&
    hasConcreteMechanism(combined) &&
    !isGenericStatusAction(rootCause) &&
    !isVagueGenericFixClaim(rootCause)
  );
}

function hasDurableReusableSignal(note: MaterializedTaskMemoryNote) {
  const payload = note.raw_payload;
  const hasVisibleSignal = hasVisibleQualitySignal(note);
  const hasFixSignal = hasDurableFixSignal(note);
  if (hasFixSignal) return hasVisibleSignal;
  if (isMostlyOneOffStatus(note)) return false;

  const hasStructuredSignal =
    Boolean(payload.reusable_patterns?.some((item) => hasConcreteTransferableText(item))) ||
    Boolean(payload.pitfalls?.some((item) => hasConcreteTransferableText(item))) ||
    Boolean(payload.decisions?.some((item) => hasConcreteTransferableText(item)));
  return hasStructuredSignal && hasVisibleSignal;
}

function hasVisibleQualitySignal(note: MaterializedTaskMemoryNote) {
  const conclusions = note.key_conclusions.join('\n').toLowerCase();
  return /root cause:|resolution:|pitfall:|pattern:|decision:|error signature:/i.test(conclusions);
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
  return (
    statusHits >= 3 &&
    (
      !hasConcreteTransferableAction(text) ||
      isGenericStatusAction(text) ||
      isStatusShapedSelfContainedItem(note)
    )
  );
}

function isStatusShapedSelfContainedItem(note: MaterializedTaskMemoryNote) {
  if (note.raw_payload.root_cause || note.raw_payload.resolution) return false;

  const text = joined(note);
  const hasStatusShape =
    /\b(current|checked|checks?|status|local|package version|version|dist output|generated dist output)\b/i
      .test(text);
  return hasStatusShape && !hasStrongReusableMechanism(text);
}

function hasStrongReusableMechanism(value: string) {
  return /\b(normalize|normalizing|parse|parsing|diverge|diverged|default data directory|race|raced|orphan|dedupe|deduplicate|foreign_keys|cascade|nulling|source_run_key)\b/i
    .test(value);
}

export function validateMaterializedNoteQuality(
  note: MaterializedTaskMemoryNote,
  options: { mode: ValidationMode },
): NoteQualityDecision {
  const warnings: string[] = [];
  const acceptedDurableFix = hasDurableFixSignal(note) && hasVisibleQualitySignal(note);

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
  if (!acceptedDurableFix && isMostlyOneOffStatus(note)) {
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
