import type { MaterializedTaskMemoryNote } from '@chatcrystal/shared';

type ValidationMode = 'auto' | 'manual';

export type NoteQualityDecision = {
  accepted: boolean;
  reason: 'note-quality-ok' | 'manual-note-quality-warning' | 'low-note-quality';
  warnings: string[];
};

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
  'move',
  'normalize',
  'parse',
  'place',
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
  'strip',
  'truncate',
  'validate',
  'wait',
  'wait for',
  'wrap',
  '避免',
  '防止',
  '复用',
] as const;

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
  return /\b(unknown|n\/a|not sure|todo|tbd|appropriate change|fix the issue|task needed investigation|expected behavior|task (?:now )?works correctly|now works correctly|expected pattern|was wrong)\b/i
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

function regexEscape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWord(text: string, word: string) {
  if (/[\u3400-\u9fff]/.test(word)) {
    return text.includes(word);
  }
  return new RegExp(`\\b${regexEscape(word)}\\b`, 'i').test(text);
}

function hasConcreteTransferableAction(value: string) {
  const text = value.toLowerCase();
  if (hasNegativeTransferableAction(text)) return true;
  if (hasSchemaDefaultArrayAction(text)) return true;
  if (hasDurableEngineeringPreventionAction(text)) return true;
  if (hasImportDedupeAction(text)) return true;
  if (hasPersistenceSerializationAction(text)) return true;
  if (hasDbTransactionAtomicityAction(text)) return true;
  if (hasElectronResourceAction(text)) return true;
  if (hasCrossPlatformPathAction(text)) return true;
  if (hasFrontendCacheInvalidationAction(text)) return true;
  if (hasSqliteWalSidecarAction(text)) return true;
  if (hasProviderBaseUrlAction(text)) return true;
  if (hasImportContentArrayAction(text)) return true;
  return concreteActionWords.some((word) => hasWord(text, word));
}

function hasNegativeTransferableAction(text: string) {
  return /\bdo not\b.+\b(read|write|call|use|access|parse)\b.+\bbefore\b.+\b(validat(?:e|ing)|check(?:ing)?|parse|parsing)\b/i
    .test(text);
}

function hasSchemaDefaultArrayAction(text: string) {
  return (
    /\b(use|change|set|default|materializ(?:e|ed)|configure)\b.+\b(schema|z\.array|default\(\[\]\)|empty array|omitted items?)\b/i
      .test(text) ||
    /\b(schema|z\.array|default\(\[\]\)|empty array|omitted items?)\b.+\b(default|materializ(?:e|ed)|empty array)\b/i
      .test(text)
  );
}

function hasPersistenceSerializationAction(text: string) {
  return hasPersistenceSnapshotEvidence(text) &&
    /\b(queue|queued|serialize|serialized|route|routed|call|called|saveDatabase|p-queue)\b/i
      .test(text) &&
    /\b(writes?|mutations?|save|transaction|snapshots?|rows|database|db)\b/i
      .test(text);
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
    /\b(the task|this task|the pattern|the implementation|implementation behavior|expected behavior|expected pattern|values?|input|correctness|reliability|maintenance|going forward)\b/.test(text);
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
    /\b(data_dir|node_env|econrefused|typeerror|note_tags|chatcrystal\.db|port|source_run_key|foreign_keys)\b|\/api\/[\w/-]+|\b[a-z0-9]+_[a-z0-9_]+\b|[a-z]:\\|\/[\w.-]+/i
      .test(text) ||
    hasChineseTechnicalEvidence(text) ||
    hasSchemaArrayEvidence(text) ||
    hasJsonParsingEvidence(text) ||
    hasProviderBaseUrlEvidence(text) ||
    hasImportContentArrayEvidence(text) ||
    hasDurableEngineeringEvidence(text) ||
    hasImportDedupeEvidence(text) ||
    hasContentSanitizationEvidence(text) ||
    hasPersistenceSnapshotEvidence(text) ||
    hasDbTransactionAtomicityEvidence(text) ||
    hasIndexConsistencyEvidence(text) ||
    hasElectronResourceEvidence(text) ||
    hasCrossPlatformPathEvidence(text) ||
    hasFrontendCacheEvidence(text) ||
    hasSqliteWalSidecarEvidence(text) ||
    hasHttpFailureSignal(text) ||
    /\b(api requests?|fastify readiness|server readiness|request setup|package metadata|package version|dist output|generated dist output|data directory|electron server|server entrypoint|client calls?)\b/i
      .test(text)
  );
}

function hasChineseTechnicalEvidence(value: string) {
  return /接口|请求|路由|注册|配置|数据库|索引|语义搜索|向量|笔记|导入|解析|去重|文件|目录|环境变量|凭据|私钥|内网|脱敏|校准|样本|夹具|数据集|元数据|来源|隐私|构建|编译/
    .test(value);
}

function hasSchemaArrayEvidence(value: string) {
  const text = value.toLowerCase();
  return (
    /\b(zod|z\.array|z\.object|request\.\w+|\w+schema)\b/i.test(text) ||
    /\.(?:optional|default)\(/i.test(text) ||
    /\bdefault\(\[\]\)\b/i.test(text)
  );
}

function hasSchemaDefaultArrayMechanism(value: string) {
  const text = value.toLowerCase();
  const hasOptionalOrDefaultArray =
    /\b(optional arrays?|omitted arrays?|omitted items?|undefined|empty array)\b/i.test(text) ||
    /\.(?:optional|default)\(/i.test(text) ||
    /\bdefault\(\[\]\)\b/i.test(text);
  const hasIterationOrHandler =
    /\b(iterat(?:e|ed|es|ing|ion)|handler|handler logic)\b/i.test(text);
  return hasSchemaArrayEvidence(text) && hasOptionalOrDefaultArray && hasIterationOrHandler;
}

function hasJsonParsingEvidence(value: string) {
  const text = value.toLowerCase();
  return /```json|\b(generatetext|extractjson|json\.parse|syntaxerror|llm summaries?|llm summary|fenced output|fenced objects?|markdown fences?|json fences?|fence text|note fields?|parsed title|parsed summary|parsed conclusions)\b/i
    .test(text);
}

function hasJsonParsingMechanism(value: string) {
  const text = value.toLowerCase();
  const hasFenceOrParser =
    /```json|\b(extractjson|json\.parse|fences?|fenced|markdown fences?|parse|parsing|parsed)\b/i
      .test(text);
  const hasStripBeforeParse =
    /\b(strip|stripped|remove|removed|trim)\b.+\b(fences?|fenced|markdown|json\.parse|parse|parsing)\b/i
      .test(text) ||
    /\b(fences?|fenced|markdown)\b.+\b(strip|stripped|remove|removed|trim)\b/i
      .test(text) ||
    /\bbefore\b.+\b(json\.parse|parse|parsing|calling json\.parse)\b/i
      .test(text);
  return hasJsonParsingEvidence(text) && hasFenceOrParser && hasStripBeforeParse;
}

function hasJsonParsingFailureSignal(value: string) {
  const text = value.toLowerCase();
  const hasParsingFailure =
    /\b(syntaxerror|throw|threw|throws?|parsing threw|not persisted|before note fields were persisted|fenced output|fenced objects?)\b/i
      .test(text);
  const hasCausalFlow =
    /\b(because|so|returned|passed|before|can return|persist)\b/i.test(text);
  return hasJsonParsingEvidence(text) && hasParsingFailure && hasCausalFlow;
}

function hasProviderBaseUrlEvidence(value: string) {
  const text = value.toLowerCase();
  return /\/v1\/chat\/completions|\/chat\/completions|\/v1\b|\b(custom provider|openai-compatible client|custom_base_url|base url|provider base url|provider url|llm)\b/i
    .test(text);
}

function hasProviderBaseUrlAction(value: string) {
  const text = value.toLowerCase();
  const hasAction = /\b(configure|configured|set|include|add)\b/i.test(text);
  const hasTarget =
    /\/v1\b|\b(custom_base_url|base url|provider base url|provider url|prefix|openai-compatible client)\b/i
      .test(text);
  return hasProviderBaseUrlEvidence(text) && hasAction && hasTarget;
}

function hasProviderBaseUrlMechanism(value: string) {
  const text = value.toLowerCase();
  const hasRelativeEndpointFlow =
    /\b(openai-compatible client|client)\b.+\b(calls?|called|appends?|relative to)\b.+\b(\/chat\/completions|base url|base)\b/i
      .test(text) ||
    /\/chat\/completions.+\b(relative to|instead of|wrong endpoint)\b|\/chat\/completions.+\/v1\/chat\/completions/i
      .test(text) ||
    /\b(custom_base_url|base url|provider base url|provider url)\b.+\b(omitted|missing|without)\b.+\/v1\b/i
      .test(text);
  const hasConfiguredPrefixFlow =
    /\b(configure|configured|set|include|add)\b.+\b(custom_base_url|base url|provider base url|provider url)\b.+(?:\/v1\b|\bprefix\b)/i
      .test(text) ||
    /(?:\/v1\b|\bprefix\b).+\b(before creating|creating)\b.+\b(openai-compatible client|client)\b/i
      .test(text);
  return hasProviderBaseUrlEvidence(text) &&
    (hasRelativeEndpointFlow || hasConfiguredPrefixFlow);
}

function hasProviderBaseUrlFailureSignal(value: string) {
  const text = value.toLowerCase();
  const hasHttpNotFound =
    /\b(http\s*)?404\b|\bnot found\b/i.test(text);
  const hasWrongEndpointFlow =
    /\b(omitted|missing|without)\b.+\/v1\b/i.test(text) ||
    /\b(called|calls?)\b.+\/chat\/completions.+\b(instead of|rather than)\b.+\/v1\/chat\/completions/i
      .test(text) ||
    /\b(wrong endpoint|relative endpoint|relative to that base)\b/i.test(text);
  const hasCausalFlow = /\b(because|so|otherwise|instead of)\b/i.test(text);
  return hasProviderBaseUrlEvidence(text) &&
    hasHttpNotFound &&
    hasWrongEndpointFlow &&
    hasCausalFlow;
}

function hasImportContentArrayEvidence(value: string) {
  const text = value.toLowerCase();
  return /\b(codex adapter|codex jsonl|response_item\.content|content arrays?|array-shaped assistant content|assistant content|assistant messages?|imported conversation messages?|empty imported conversation messages?|text fragments?)\b/i
    .test(text);
}

function hasImportContentArrayAction(value: string) {
  const text = value.toLowerCase();
  const hasAction =
    /\b(parse|parsed|extract|extracted|join|joined|save|saving)\b/i.test(text);
  const hasTarget =
    /\b(response_item\.content|content arrays?|assistant content|text fragments?|conversation messages?|assistant messages?)\b/i
      .test(text);
  return hasImportContentArrayEvidence(text) && hasAction && hasTarget;
}

function hasImportContentArrayMechanism(value: string) {
  const text = value.toLowerCase();
  const hasStringVsArrayFlow =
    /\btreated\b.+\bresponse_item\.content\b.+\bplain string\b/i.test(text) ||
    /\barray-shaped assistant content\b/i.test(text) ||
    /\bresponse_item\.content arrays?\b/i.test(text);
  const hasParseJoinFlow =
    /\b(parse|extract)\b.+\b(response_item\.content|content arrays?)\b.+\b(join|text fragments?|save|saving|conversation messages?)\b/i
      .test(text) ||
    /\b(join|joined)\b.+\btext fragments?\b.+\b(before saving|conversation messages?|assistant messages?)\b/i
      .test(text);
  return hasImportContentArrayEvidence(text) && (hasStringVsArrayFlow || hasParseJoinFlow);
}

function hasImportContentArrayFailureSignal(value: string) {
  const text = value.toLowerCase();
  const hasContentLoss =
    /\b(empty turns?|empty imported conversation messages?|empty messages?|missing assistant text|lost assistant text|lost assistant content|missing assistant content|without assistant text)\b/i
      .test(text);
  const hasCausalFlow = /\b(so|because|instead of|produced|lost|missing)\b/i.test(text);
  return hasImportContentArrayEvidence(text) && hasContentLoss && hasCausalFlow;
}

function hasDurableEngineeringEvidence(value: string) {
  const text = value.toLowerCase();
  return /\b(json|jsonl|fixtures?|fixture corpora|corpus|samples?|calibration samples?|calibration corpus|dataset object|fixture object|experience-gate|provenance|contains_real_user_data|synthetic data|raw local paths?|raw user paths?|private ips?|credentials?|private-key text|secret-like tokens?|secrets?|sanitization rules?)\b/i
    .test(text);
}

function hasDurableEngineeringPreventionAction(value: string) {
  const text = value.toLowerCase();
  return hasDurableEngineeringEvidence(text) &&
    /\b(wrap|store|stored|reject|rejects?|test|tests|sanitize|sanitiz(?:e|ed|es|ing|ation)|strip|validate|assert|assertions?)\b/i
      .test(text);
}

function hasDurableEngineeringMechanism(value: string) {
  const text = value.toLowerCase();
  const hasConcreteGovernanceMechanism =
    /\b(dataset object|fixture object|provenance metadata|synthetic provenance|provenance|privacy assertions?|contains_real_user_data=false|sanitization rules?|tests? that reject|before committing|review context)\b/i
      .test(text);
  const hasSensitiveDataEvidence =
    /\b(raw local paths?|raw user paths?|private ips?|credentials?|private-key text|secret-like tokens?|secrets?)\b/i
      .test(text);
  const hasDataArtifact =
    /\b(json sample arrays?|json|fixtures?|fixture corpora|corpus|samples?|calibration samples?|calibration corpus|dataset object|fixture object|experience-gate)\b/i
      .test(text);
  return hasDurableEngineeringEvidence(text) &&
    (
      hasConcreteGovernanceMechanism ||
      (hasDurableEngineeringPreventionAction(text) && hasSensitiveDataEvidence && hasDataArtifact)
    );
}

function hasDurableEngineeringFailureSignal(value: string) {
  const text = value.toLowerCase();
  const hasConcreteConsequence =
    /\b(hid whether|could commit|cannot silently include|silently include|leak(?:ed|s|ing)?|raw local paths?|raw user paths?|private ips?|credentials?|private-key text|secret-like tokens?|secrets?|without review context|missing review context|privacy leak|private data|sensitive data)\b/i
      .test(text);
  const hasFailureFlow =
    /\b(because|so|caused|led to|hid whether|could commit|cannot silently include|without review context|leak(?:ed|s|ing)?|returned|overwrote|threw)\b/i
      .test(text);
  return hasDurableEngineeringEvidence(text) && hasConcreteConsequence && hasFailureFlow;
}

function hasImportDedupeEvidence(value: string) {
  const text = value.toLowerCase();
  return /\b(chokidar|jsonl|mtime|file size|source file size|file revision|import scan|adapter|import dedupe key|dedupe key|duplicate inserts?|unchanged [\w -]*files?|reparsed|reparse|same file revision)\b/i
    .test(text);
}

function hasImportDedupeAction(value: string) {
  const text = value.toLowerCase();
  const hasDedupeAction = /\b(use|skip|dedupe|deduplicate|key|compare|track)\b/i.test(text);
  const hasRevisionKey =
    /\b(file size|source file size|mtime|dedupe key|file revision|skip parsing|same file revision)\b/i
      .test(text);
  return hasImportDedupeEvidence(text) && hasDedupeAction && hasRevisionKey;
}

function hasImportDedupeMechanism(value: string) {
  const text = value.toLowerCase();
  const hasDedupeFlow =
    /\b(import dedupe|dedupe key|dedupe|deduplicate|skip parsing|same file revision)\b/i
      .test(text);
  const hasRevisionOrWatcherEvidence =
    /\b(file size|source file size|mtime|file revision|same file revision|chokidar|unchanged [\w -]*files?|jsonl|reparsed|reparse|repeated)\b/i
      .test(text);
  return hasImportDedupeEvidence(text) && hasDedupeFlow && hasRevisionOrWatcherEvidence;
}

function hasImportDedupeFailureSignal(value: string) {
  const text = value.toLowerCase();
  const hasRepeatedImportConsequence =
    /\b(repeated events?|repeated jsonl parsing|reparsed|reparse|duplicate inserts?|same conversation|every chokidar event)\b/i
      .test(text);
  const hasCausalFlow = /\b(because|so|otherwise|attempted|prevents?|preventing)\b/i.test(text);
  return hasImportDedupeEvidence(text) && hasRepeatedImportConsequence && hasCausalFlow;
}

function hasContentSanitizationEvidence(value: string) {
  const text = value.toLowerCase();
  return /<system-reminder>|<command-name>|\b(jsonl|source adapter|adapter|claude code|sanitizecontent|system xml tags?|xml tags?|system-reminder|command-name|system noise|raw jsonl|message content|human-facing notes?|note content|imported conversation messages?)\b/i
    .test(text);
}

function hasContentSanitizationMechanism(value: string) {
  const text = value.toLowerCase();
  const hasSanitizeAction =
    /\b(sanitize|sanitized|sanitizecontent|strip|stripped|remove|removed|filter|filtered|clean)\b/i
      .test(text);
  const hasImportedContentFlow =
    /\b(pars(?:e|ed|es|ing)|sav(?:e|ed|es|ing)|import(?:ed|ing)?|raw jsonl|message content|conversation messages?|before saving)\b/i
      .test(text);
  const hasNoiseOrTagTarget =
    /<system-reminder>|<command-name>|\b(system xml tags?|xml tags?|system-reminder|command-name|system noise|raw jsonl|message content)\b/i
      .test(text);
  return hasContentSanitizationEvidence(text) &&
    hasSanitizeAction &&
    (hasImportedContentFlow || hasNoiseOrTagTarget);
}

function hasContentSanitizationFailureSignal(value: string) {
  const text = value.toLowerCase();
  const hasLeakOrPollution =
    /\b(leak(?:ed|s|ing)?|pollut(?:e|ed|es|ing|ion)|system noise|raw jsonl|become note content|human-facing notes?|note content)\b/i
      .test(text);
  const hasCausalFlow =
    /\b(because|so|leak(?:ed|s|ing)? into|does not become|before saving|raw jsonl message content)\b/i
      .test(text);
  return hasContentSanitizationEvidence(text) && hasLeakOrPollution && hasCausalFlow;
}

function hasPersistenceSnapshotEvidence(value: string) {
  const text = value.toLowerCase();
  return /\b(sql\.js|chatcrystal\.db|savedatabase|p-queue|db writes?|db mutations?|db snapshots?|database snapshots?|committed rows|in-memory connection|auto-save)\b/i
    .test(text);
}

function hasPersistenceSerializationMechanism(value: string) {
  const text = value.toLowerCase();
  const hasPersistenceFlow =
    /\b(auto-save|persist|persisted|saveDatabase|snapshots?|db bytes|bytes|committed rows|transaction|stale state|stale snapshots?|stale chatcrystal\.db|overwrite|newer rows)\b/i
      .test(text);
  const hasMutationConcurrency =
    /\b(concurrent|concurrently|same in-memory connection|same sql\.js database|mutat(?:e|ed|es|ing|ion)|later save|overwrite|while)\b/i
      .test(text);
  const hasSerialization =
    /\b(queue|queued|serialize|serialized|p-queue|through one p-queue|after the transaction|route|routed|saveDatabase after)\b/i
      .test(text);
  return hasPersistenceSnapshotEvidence(text) &&
    (
      (hasSerialization && hasPersistenceFlow) ||
      (hasPersistenceFlow && hasMutationConcurrency)
    );
}

function hasIndexConsistencyEvidence(value: string) {
  const text = value.toLowerCase();
  return /\b(vectra|semantic search|note_id|search index|vector index|index entries?|deleted notes?|note rows?|sql\.js rows?)\b/i
    .test(text);
}

function hasIndexConsistencyMechanism(value: string) {
  const text = value.toLowerCase();
  const hasIndexReference =
    /\b(vectra|semantic search|note_id|search index|vector index|index entries?)\b/i
      .test(text);
  const hasDeletionOrCleanup =
    /\b(delet(?:e|ed|es|ing|ion)|remov(?:e|ed|es|ing)|clean(?:up| up)|prun(?:e|ed|es|ing))\b/i
      .test(text);
  const hasStaleOrDeletedReference =
    /\b(stale|orphan|deleted notes?|stale note_id hits?|note_id hits?|return(?:ed|s|ing)? stale|return(?:ed|s|ing)? deleted)\b/i
      .test(text);
  const hasRowIndexRelation =
    /\b(sql\.js rows?|note rows?|rows?)\b.+\b(vectra|semantic search|search index|vector index|index entries?)\b/i
      .test(text) ||
    /\b(vectra|semantic search|search index|vector index|index entries?)\b.+\b(sql\.js rows?|note rows?|rows?)\b/i
      .test(text);
  return hasIndexConsistencyEvidence(text) &&
    hasIndexReference &&
    hasDeletionOrCleanup &&
    (hasStaleOrDeletedReference || hasRowIndexRelation);
}

function hasIndexConsistencyFailureSignal(value: string) {
  const text = value.toLowerCase();
  const hasStaleReference =
    /\b(stale|orphan|deleted notes?|stale note_id hits?|note_id hits?|return(?:ed|s|ing)? stale|return(?:ed|s|ing)? deleted)\b/i
      .test(text);
  const hasCausalDeletion =
    /\b(because|without|after delet(?:e|ing)|after removing|removed|deletion|delet(?:e|ed|es|ing)|cannot return|leaves?)\b/i
      .test(text);
  return hasIndexConsistencyEvidence(text) && hasStaleReference && hasCausalDeletion;
}

function hasFrontendCacheEvidence(value: string) {
  const text = value.toLowerCase();
  return /\b(react query|query keys?|deletenote|delete mutation|note delete mutation|tags cache|notes cache|sidebar|tag counts?|filter chips?|stale tag filters?|derived tag counts?)\b/i
    .test(text);
}

function hasFrontendCacheInvalidationAction(value: string) {
  const text = value.toLowerCase();
  const hasCacheAction = /\b(invalidate|invalidated|refetch|reload|refresh|update)\b/i.test(text);
  const hasCacheTarget = /\b(cache|query keys?|react query|tags?|notes?|tag counts?)\b/i.test(text);
  return hasFrontendCacheEvidence(text) && hasCacheAction && hasCacheTarget;
}

function hasFrontendCacheInvalidationMechanism(value: string) {
  const text = value.toLowerCase();
  const hasInvalidationFlow =
    /\b(invalidate|invalidated|refetch|reload|refresh|update)\b.+\b(cache|query keys?|react query|tags?|notes?|tag counts?)\b/i
      .test(text) ||
    /\b(cache|query keys?|react query|tags?|notes?|tag counts?)\b.+\b(invalidate|invalidated|refetch|reload|refresh|update)\b/i
      .test(text);
  const hasMutationOrDeleteContext =
    /\b(after|when|once|succeeds?|delete|deleted|deletenote|delete mutation|mutation|removed sql row|sql row)\b/i
      .test(text);
  return hasFrontendCacheEvidence(text) && hasInvalidationFlow && hasMutationOrDeleteContext;
}

function hasFrontendCacheFailureSignal(value: string) {
  const text = value.toLowerCase();
  const hasStaleUi =
    /\b(stale|kept stale|does not show stale|cannot show stale|stale tag filters?|stale filter chips?|stale tag counts?|stale note tags?)\b/i
      .test(text);
  const hasUiTarget =
    /\b(sidebar|filter chips?|tag filters?|tag counts?|derived tag counts?|ui|react query|tags cache|notes cache)\b/i
      .test(text);
  const hasCausalFlow =
    /\b(so|because|after|but|did not invalidate|removed|delete|deletion|leaves?)\b/i
      .test(text);
  return hasFrontendCacheEvidence(text) && hasStaleUi && hasUiTarget && hasCausalFlow;
}

function hasSqliteWalSidecarEvidence(value: string) {
  const text = value.toLowerCase();
  return /\b(state\.vscdb(?:-(?:wal|shm))?|workspacestorage|cursor|trae|sql\.js|wal|shm|sidecars?|composer metadata|database rows?|chat rows?|committed wal pages?)\b/i
    .test(text);
}

function hasSqliteWalSidecarAction(value: string) {
  const text = value.toLowerCase();
  const hasWalAction = /\b(copy|copied|include|open|opening|read|reading)\b/i.test(text);
  const hasWalTarget =
    /\b(state\.vscdb|state\.vscdb-wal|state\.vscdb-shm|wal|shm|sidecars?|sql\.js|database)\b/i
      .test(text);
  return hasSqliteWalSidecarEvidence(text) && hasWalAction && hasWalTarget;
}

function hasSqliteWalSidecarMechanism(value: string) {
  const text = value.toLowerCase();
  const hasCopySidecarFlow =
    /\bcopy\b.+\bstate\.vscdb\b.+\b(?:state\.vscdb-wal|wal|-wal)\b.+\b(?:state\.vscdb-shm|shm|-shm)\b/i
      .test(text) ||
    /\b(?:wal|shm|sidecars?)\b.+\bcopy|copied\b/i.test(text);
  const hasOpenWithSqlJsFlow =
    /\b(before|when|so)\b.+\b(open|opening|sql\.js|committed wal pages?)\b/i.test(text) ||
    /\b(open|opening|sql\.js|committed wal pages?)\b.+\b(before|when|so|sees?)\b/i.test(text);
  const hasReadOnlyDbFlow =
    /\b(reading only|read only)\b.+\bstate\.vscdb\b.+\bsql\.js\b/i.test(text) ||
    /\bstate\.vscdb-wal\b.+\b(recent|composer metadata|committed wal pages?)\b/i.test(text);
  return hasSqliteWalSidecarEvidence(text) &&
    (
      (hasCopySidecarFlow && hasOpenWithSqlJsFlow) ||
      hasReadOnlyDbFlow
    );
}

function hasSqliteWalSidecarFailureSignal(value: string) {
  const text = value.toLowerCase();
  const hasMissingOrStaleRows =
    /\b(stale|missing|not missing|hides?|returned stale|returned missing|missing chat rows?|missing composer metadata|missing rows?)\b/i
      .test(text);
  const hasRowTarget =
    /\b(composer metadata|composer rows?|chat rows?|database rows?|rows?|committed wal pages?|state\.vscdb-wal|wal)\b/i
      .test(text);
  const hasCausalFlow =
    /\b(because|so|reading only|only state\.vscdb|before opening|kept recent|returned)\b/i
      .test(text);
  const hasDirectWalConsequence =
    /\b(wal|state\.vscdb-wal|sidecars?)\b.+\b(hides?|stale|missing)\b.+\b(composer metadata|composer rows?|chat rows?|rows?)\b/i
      .test(text) ||
    /\b(hides?|stale|missing)\b.+\b(composer metadata|composer rows?|chat rows?|rows?)\b.+\b(wal|state\.vscdb-wal|sidecars?)\b/i
      .test(text);
  return hasSqliteWalSidecarEvidence(text) &&
    hasMissingOrStaleRows &&
    hasRowTarget &&
    (hasCausalFlow || hasDirectWalConsequence);
}

function hasElectronResourceEvidence(value: string) {
  const text = value.toLowerCase();
  return /\b(packaged electron|packaged builds?|electron-builder|extraresources|process\.resourcespath|resourcespath|resource path|bundled server code|wasm|sql-wasm\.wasm|sql\.js|enoent|chatcrystal\.db)\b/i
    .test(text);
}

function hasElectronResourceAction(value: string) {
  const text = value.toLowerCase();
  const hasResourceAction =
    /\b(add|include|copy|resolve|load|initialize|open)\b/i.test(text);
  const hasResourceTarget =
    /\b(sql-wasm\.wasm|wasm|process\.resourcespath|resourcespath|extraresources|resource path|resources?|sql\.js|chatcrystal\.db)\b/i
      .test(text);
  return hasElectronResourceEvidence(text) && hasResourceAction && hasResourceTarget;
}

function hasElectronResourceMechanism(value: string) {
  const text = value.toLowerCase();
  const hasResourcePathFlow =
    /\b(add|include|copy|resolve|load)\b.+\b(sql-wasm\.wasm|wasm|process\.resourcespath|resourcespath|extraresources|resource path|resources?|sql\.js)\b/i
      .test(text) ||
    /\b(sql-wasm\.wasm|wasm|process\.resourcespath|resourcespath|extraresources|resource path|resources?|sql\.js)\b.+\b(add|include|copy|resolve|load)\b/i
      .test(text);
  const hasPackagedResourceFlow =
    /\b(packaged electron|packaged builds?|electron-builder|bundled server code)\b.+\b(sql-wasm\.wasm|wasm|resource|resourcespath|extraresources|copy|copied|location)\b/i
      .test(text) ||
    /\b(sql-wasm\.wasm|wasm|resource|resourcespath|extraresources|copy|copied|location)\b.+\b(packaged electron|packaged builds?|electron-builder|bundled server code)\b/i
      .test(text);
  return hasElectronResourceEvidence(text) && (hasResourcePathFlow || hasPackagedResourceFlow);
}

function hasElectronResourceFailureSignal(value: string) {
  const text = value.toLowerCase();
  const hasResourceFailure =
    /\b(enoent|initialization throws?|throws? enoent|missing resource|not copied|did not copy|cannot open|cannot init|cannot initialize|failed to open|failed to initialize)\b/i
      .test(text);
  const hasCausalFlow =
    /\b(because|when|but|relative to|before|without|not copied|did not copy)\b/i
      .test(text);
  return hasElectronResourceEvidence(text) && hasResourceFailure && hasCausalFlow;
}

function hasCrossPlatformPathEvidence(value: string) {
  const text = value.toLowerCase();
  return /\b(path\.win32|resolvedatadirfortest|data_dir|posix|ubuntu runners?|windows data_dir|windows fixture|windows paths?|c:\/users|c:\\users|repository path|repo path)\b/i
    .test(text);
}

function hasCrossPlatformPathAction(value: string) {
  const text = value.toLowerCase();
  const hasPathAction = /\b(normalize|compare|comparing|resolve|treat|treated)\b/i.test(text);
  const hasPathTarget =
    /\b(path\.win32|resolvedatadirfortest|data_dir|fixture expectations?|windows paths?|posix runners?|path parsing)\b/i
      .test(text);
  return hasCrossPlatformPathEvidence(text) && hasPathAction && hasPathTarget;
}

function hasCrossPlatformPathMechanism(value: string) {
  const text = value.toLowerCase();
  const hasNormalizationFlow =
    /\b(normalize|compare|comparing|resolve)\b.+\b(path\.win32|windows data_dir|windows fixture|c:\/users|posix runners?|resolvedatadirfortest)\b/i
      .test(text) ||
    /\b(path\.win32|windows data_dir|windows fixture|c:\/users|posix runners?|resolvedatadirfortest)\b.+\b(normalize|compare|comparing|resolve)\b/i
      .test(text);
  const hasRelativePathFlow =
    /\b(posix|ubuntu runners?|node posix path parsing|path parsing)\b.+\b(prepend(?:ed|s)?|relative|treated)\b/i
      .test(text) ||
    /\b(windows data_dir|windows fixture|c:\/users|c:\\users)\b.+\b(relative|prepended|repository path|repo path)\b/i
      .test(text);
  return hasCrossPlatformPathEvidence(text) && (hasNormalizationFlow || hasRelativePathFlow);
}

function hasCrossPlatformPathFailureSignal(value: string) {
  const text = value.toLowerCase();
  const hasPathFailure =
    /\b(prepend(?:ed|s)? the (?:repository|repo) path|treated .+ as relative|as relative|relative path|wrong path|wrong directory)\b/i
      .test(text);
  const hasCausalFlow = /\b(because|when|so|before|treated|prepended)\b/i.test(text);
  return hasCrossPlatformPathEvidence(text) && hasPathFailure && hasCausalFlow;
}

function hasConcreteMechanism(value: string) {
  const text = value.toLowerCase();
  const hasGenericReleaseValidation = isGenericReleaseValidationClaim(text);
  const hasTimingOrder =
    !hasGenericReleaseValidation &&
    (
      /\b(before|after|until|when)\b.+\b(import|importing|issue|issuing|request|requests|setup|ready|readiness|server|startup|data_dir|entrypoint|metadata|dist|compare|comparing)\b/i
      .test(text) ||
      /\b(import|importing|issue|issuing|request|requests|setup|ready|readiness|server|startup|data_dir|entrypoint|metadata|dist|compare|comparing)\b.+\b(before|after|until|when)\b/i
        .test(text)
    );
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
  const hasParserFieldValidation =
    /\b(typeerror|parser|parsing|jsonl|response_item\.content|partial events?|partial codex events?|event shape|parser fields)\b.+\b(before|after|without content|validat(?:e|ing)|read(?:ing)?|skips?)\b/i
      .test(text) ||
    /\b(before|after|without content|validat(?:e|ing)|read(?:ing)?|skips?)\b.+\b(typeerror|parser|parsing|jsonl|response_item\.content|partial events?|partial codex events?|event shape|parser fields)\b/i
      .test(text);
  const hasRetryBackoffFlow =
    /\b(retry|retried|retries|queue|queued|provider requests?)\b.+\b(rate[- ]limit|http 429|429|retry-after|backoff|delay|resuming batch summarization)\b/i
      .test(text) ||
    /\b(rate[- ]limit|http 429|429|retry-after|backoff|delay)\b.+\b(retry|retried|retries|queue|queued|provider requests?)\b/i
      .test(text);
  const hasSchemaDefaultArrayFlow = hasSchemaDefaultArrayMechanism(text);
  const hasJsonParsingFlow = hasJsonParsingMechanism(text);
  const hasProviderBaseUrlFlow = hasProviderBaseUrlMechanism(text);
  const hasImportContentArrayFlow = hasImportContentArrayMechanism(text);
  const hasDurableEngineeringFlow = hasDurableEngineeringMechanism(text);
  const hasImportDedupeFlow = hasImportDedupeMechanism(text);
  const hasContentSanitizationFlow = hasContentSanitizationMechanism(text);
  const hasPersistenceSerializationFlow = hasPersistenceSerializationMechanism(text);
  const hasDbTransactionAtomicityFlow = hasDbTransactionAtomicityMechanism(text);
  const hasIndexConsistencyFlow = hasIndexConsistencyMechanism(text);
  const hasElectronResourceFlow = hasElectronResourceMechanism(text);
  const hasCrossPlatformPathFlow = hasCrossPlatformPathMechanism(text);
  const hasFrontendCacheFlow = hasFrontendCacheInvalidationMechanism(text);
  const hasSqliteWalSidecarFlow = hasSqliteWalSidecarMechanism(text);
  return (
    hasTimingOrder ||
    hasRaceReadiness ||
    hasPackageDistFlow ||
    hasDataDirFallback ||
    hasRelationalCleanup ||
    hasDedupeKey ||
    hasRequestFailureOrdering ||
    hasParserFieldValidation ||
    hasRetryBackoffFlow ||
    hasSchemaDefaultArrayFlow ||
    hasJsonParsingFlow ||
    hasProviderBaseUrlFlow ||
    hasImportContentArrayFlow ||
    hasDurableEngineeringFlow ||
    hasImportDedupeFlow ||
    hasContentSanitizationFlow ||
    hasPersistenceSerializationFlow ||
    hasDbTransactionAtomicityFlow ||
    hasIndexConsistencyFlow ||
    hasElectronResourceFlow ||
    hasCrossPlatformPathFlow ||
    hasFrontendCacheFlow ||
    hasSqliteWalSidecarFlow
  );
}

function hasConcreteTransferableText(value: string) {
  if (hasPackageDistRootCauseShape(value) && !hasPackageItemSignal(value)) return false;
  const hasConcreteConsequence =
    hasFailureOrConsequenceSignal(value) ||
    (hasPackageDistRootCauseShape(value) && hasPackageDistRootCauseSignal(value));
  return (
    hasNonPlaceholderMeaningfulText(value) &&
    hasConcreteTransferableAction(value) &&
    hasSpecificEvidence(value) &&
    hasConcreteMechanism(value) &&
    hasConcreteConsequence &&
    !isExistenceOnlyClaim(value) &&
    !isFirstPersonDiaryClaim(value) &&
    !isGenericReleaseValidationClaim(value) &&
    !isGenericStatusAction(value) &&
    !isVagueGenericLesson(value)
  );
}

function isFirstPersonDiaryClaim(value: string) {
  if (hasChineseFirstPersonDiaryClaim(value)) return true;
  const diaryVerbs = Array.from(new Set([
    ...concreteActionWords.filter((word) => !/[\u3400-\u9fff]/.test(word)),
    'added',
    'changed',
    'checked',
    'confirmed',
    'configured',
    'diagnosed',
    'discovered',
    'fixed',
    'found',
    'implemented',
    'imported',
    'caused',
    'let',
    'loaded',
    'made',
    'moved',
    'normalized',
    'parsed',
    'pruned',
    'reviewed',
    'resolved',
    'sanitized',
    'stripped',
    'switched',
    'tested',
    'updated',
    'verified',
  ]))
    .map(regexEscape)
    .join('|');
  return new RegExp(
    `(?:^|[:.!?,;]\\s*|\\b(?:and|then|but|so)\\s+)\\b(?:i|we)\\s+(?:${diaryVerbs})\\b`,
    'i',
  )
    .test(value);
}

function hasChineseFirstPersonDiaryClaim(value: string) {
  const chineseAction = '(?:添加|修复|设置|配置|注册|等待|发现|验证|检查|确认|诊断|切换|更新|实现|改动|修改|处理|解决|去掉|剥离|规范化|清理|解析|移除|删除|过滤|截断|剪枝)';
  const englishAction = Array.from(new Set([
    ...concreteActionWords.filter((word) => !/[\u3400-\u9fff]/.test(word)),
    'added',
    'configured',
    'fixed',
    'imported',
    'importing',
    'placed',
    'registered',
    'switched',
    'updated',
    'validated',
    'verified',
  ]))
    .map(regexEscape)
    .join('|');
  const subjectElidedAction =
    `(?:已经|已)(?:${chineseAction}|(?:把|将|在|为).{0,80}(?:${chineseAction}|\\b(?:${englishAction})\\b))`;
  const causativeAction =
    `(?:我|我们)(?:已经|已)?(?:让|使).{0,80}(?:${chineseAction}|\\b(?:${englishAction})\\b)`;
  return new RegExp(`(?:我|我们)(?:已经|已)?${chineseAction}|(?:我|我们)(?:已经|已)?(?:把|将).{0,80}(?:${chineseAction}|\\b(?:${englishAction})\\b)|${subjectElidedAction}|${causativeAction}`, 'i')
    .test(value);
}

function hasPackageItemSignal(value: string) {
  const text = value.toLowerCase();
  if (/\b(current|local|status checks?|checked)\b/i.test(text)) return false;
  return hasPackageDistRootCauseSignal(text);
}

function hasFailureOrConsequenceSignal(value: string) {
  return (
    /\b(race|raced|orphan|dedupe|deduplicate|stale dist|dist diverge|dist diverged|diverge|diverged|econrefused|typeerror|threw|throws?|readiness issue|startup race|invalid note_tags|foreign_keys|cascade|nulling|source_run_key collision)\b/i
      .test(value) ||
    hasSchemaArrayFailureSignal(value) ||
    hasJsonParsingFailureSignal(value) ||
    hasProviderBaseUrlFailureSignal(value) ||
    hasImportContentArrayFailureSignal(value) ||
    hasDurableEngineeringFailureSignal(value) ||
    hasImportDedupeFailureSignal(value) ||
    hasContentSanitizationFailureSignal(value) ||
    hasPersistenceSnapshotFailureSignal(value) ||
    hasDbTransactionAtomicityFailureSignal(value) ||
    hasIndexConsistencyFailureSignal(value) ||
    hasElectronResourceFailureSignal(value) ||
    hasCrossPlatformPathFailureSignal(value) ||
    hasFrontendCacheFailureSignal(value) ||
    hasSqliteWalSidecarFailureSignal(value) ||
    hasDefaultDataDirectoryConsequence(value) ||
    hasHttpFailureSignal(value)
  );
}

function hasSchemaArrayFailureSignal(value: string) {
  const text = value.toLowerCase();
  const hasArrayFailure =
    /\b(undefined|throws?|throw|omitted arrays?|omitted items?|optional arrays?)\b/i.test(text) ||
    /\.optional\(\)/i.test(text);
  const hasIterationOrHandler =
    /\b(iterat(?:e|ed|es|ing|ion)|handler|handler logic)\b/i.test(text);
  return hasSchemaArrayEvidence(text) && hasArrayFailure && hasIterationOrHandler;
}

function hasPersistenceSnapshotFailureSignal(value: string) {
  const text = value.toLowerCase();
  const hasSnapshotFailure =
    /\b(stale|overwrite|newer rows|committed rows|persist stale|stale state|stale snapshots?|snapshot mismatch|snapshots? match)\b/i
      .test(text);
  const hasCausalFlow =
    /\b(because|while|so|concurrent|concurrently|same in-memory connection|mutat(?:e|ed|es|ing|ion)|auto-save|later save|overwrite|transaction)\b/i
      .test(text);
  return hasPersistenceSnapshotEvidence(text) && hasSnapshotFailure && hasCausalFlow;
}

function hasDbTransactionAtomicityEvidence(value: string) {
  const text = value.toLowerCase();
  const hasDbImportContext = /\b(sql\.js|database|db|import|imports?|conversation imports?)\b/i
    .test(text);
  const hasAtomicityTarget =
    /\b(conversation rows?|message rows?|conversation row|message insert|message inserts?|conversation inserts?|transaction|rollback|roll back|partial conversation rows?|partial rows?)\b/i
      .test(text);
  return hasDbImportContext && hasAtomicityTarget;
}

function hasDbTransactionAtomicityAction(value: string) {
  const text = value.toLowerCase();
  const hasTransactionAction =
    /\b(wrap|begin|commit|rollback|roll back|use)\b/i.test(text);
  const hasRelatedInsertTarget =
    /\b(transaction|conversation and message inserts?|conversation rows?|message rows?|message inserts?|failed imports?|whole conversation)\b/i
      .test(text);
  return hasDbTransactionAtomicityEvidence(text) && hasTransactionAction && hasRelatedInsertTarget;
}

function hasDbTransactionAtomicityMechanism(value: string) {
  const text = value.toLowerCase();
  const hasTransactionWrapFlow =
    /\b(wrap|begin|use)\b.+\b(conversation|message|insert|imports?)\b.+\btransaction\b/i
      .test(text) ||
    /\btransaction\b.+\b(conversation|message|insert|imports?)\b/i
      .test(text);
  const hasRollbackFlow =
    /\b(failed imports?|failed message insert|failure)\b.+\b(rollback|roll back|partial|whole conversation)\b/i
      .test(text) ||
    /\b(rollback|roll back)\b.+\b(failed imports?|failed message insert|whole conversation)\b/i
      .test(text);
  const hasPartialInsertFlow =
    /\binserted\b.+\bconversation row\b.+\bbefore\b.+\bmessage rows?\b/i
      .test(text) ||
    /\bfailed message insert\b.+\bleft\b.+\bpartial conversation rows?\b/i
      .test(text);
  return hasDbTransactionAtomicityEvidence(text) &&
    ((hasTransactionWrapFlow && hasRollbackFlow) || hasPartialInsertFlow);
}

function hasDbTransactionAtomicityFailureSignal(value: string) {
  const text = value.toLowerCase();
  const hasPartialImportConsequence =
    /\b(partial conversation rows?|partial rows?|failed message insert left|incomplete import|inconsistent data)\b/i
      .test(text);
  const hasCausalFlow =
    /\b(because|so|failed|left|prevents?|rolls? back|rollback|roll back|before)\b/i
      .test(text);
  return hasDbTransactionAtomicityEvidence(text) && hasPartialImportConsequence && hasCausalFlow;
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
  return hasConcreteRootCauseMechanism(value) ||
    hasRateLimitRetryRootCauseSignal(value) ||
    hasProviderBaseUrlFailureSignal(value);
}

function hasRateLimitRetryRootCauseSignal(value: string) {
  const text = value.toLowerCase();
  return (
    /\b(http\s*)?429\b/.test(text) &&
    /\b(rate[- ]limit|retry-after|backoff|queue|queued|provider api requests?|provider requests?)\b/i
      .test(text) &&
    /\b(retried immediately|retry immediately|without rate[- ]limit backoff|without backoff|backoff|retry-after|delay)\b/i
      .test(text)
  );
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
    .test(value) ||
    /\bvalidate\b.+\b(?:to\s+)?(?:prevent|avoid)\b.+\b(future failures?|failures?|issues?)\b/i
    .test(value) ||
    /\badd\b.+\b(readiness|guard)\b.+\b(prevent|avoid)\b.+\b(future failures?|failures?|issues?)\b/i
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
    !isVagueGenericFixClaim(rootCause) &&
    !isFirstPersonDiaryClaim(rootCause) &&
    !isFirstPersonDiaryClaim(resolution)
  );
}

function hasDurableReusableSignal(note: MaterializedTaskMemoryNote) {
  const payload = note.raw_payload;
  const hasVisibleSignal = hasVisibleQualitySignal(note);
  const hasVisibleTitleSummarySignal = hasVisibleTitleSummaryQuality(note);
  const hasVisibleFixSignal = hasVisibleConcreteFixSignal(note);
  const hasFixSignal = hasDurableFixSignal(note);
  if (!hasVisibleTitleSummarySignal) return false;
  if (hasVisibleConclusionBoilerplate(note)) return false;
  if (payload.outcome_type === 'fix') return hasFixSignal && hasVisibleFixSignal;
  if (hasFixSignal) return hasVisibleFixSignal;
  if (isMostlyOneOffStatus(note)) return false;

  const hasStructuredSignal =
    Boolean(payload.reusable_patterns?.some((item) => hasConcreteTransferableText(item))) ||
    Boolean(payload.pitfalls?.some((item) => hasConcreteTransferableText(item))) ||
    Boolean(payload.decisions?.some((item) => hasConcreteTransferableText(item)));
  return hasStructuredSignal && hasVisibleStructuredSignal(note) && hasVisibleSignal;
}

function hasVisibleTitleSummaryQuality(note: MaterializedTaskMemoryNote) {
  return hasVisibleTitleQuality(note.title) && hasVisibleSummaryQuality(note.summary);
}

function hasVisibleTitleQuality(title: string) {
  return (
    hasNonPlaceholderMeaningfulText(title, 10, 6) &&
    hasVisibleConcreteContent(title) &&
    !isGenericTitle(title) &&
    !isFirstPersonDiaryClaim(title) &&
    !isVisibleWorkLogClaim(title) &&
    !isLowValueOutcomeStatusClaim(title) &&
    !isVagueGenericFixClaim(title) &&
    !isMetaReusableClaim(title) &&
    !isGenericVisibleBoilerplateClaim(title) &&
    !isChineseVisibleStatusShell(title) &&
    !isVisibleStatusSnapshotText(title)
  );
}

function hasVisibleSummaryQuality(summary: string) {
  return (
    hasNonPlaceholderMeaningfulText(summary) &&
    hasVisibleConcreteContent(summary) &&
    !isFirstPersonDiaryClaim(summary) &&
    !isVisibleWorkLogClaim(summary) &&
    !isLowValueOutcomeStatusClaim(summary) &&
    !isVagueGenericFixClaim(summary) &&
    !isMetaReusableClaim(summary) &&
    !isGenericVisibleBoilerplateClaim(summary) &&
    !isChineseVisibleStatusShell(summary) &&
    !isVisibleStatusSnapshotText(summary)
  );
}

function hasVisibleConcreteContent(value: string) {
  const text = value.toLowerCase();
  if (isLowValueOutcomeStatusClaim(text)) return false;
  if (isChineseVisibleStatusShell(text)) return false;
  if (isGenericReleaseValidationClaim(text)) return false;
  if (hasSpecificEvidence(text) && hasConcreteMechanism(text)) return true;
  if (hasSpecificEvidence(text) && hasFailureOrConsequenceSignal(text)) return true;
  if (hasPackageDistRootCauseSignal(text)) return true;
  if (/\bdata_dir\b.+\b(electron|import ordering|server entrypoint)\b/i.test(text)) return true;
  return /\bdata_dir\b.+\b(prevents?|avoids?)\b.+\bfallback\b/i.test(text);
}

function isVisibleWorkLogClaim(value: string) {
  return /^(added|changed|checked|confirmed|diagnosed|discovered|fixed|found|implemented|noted|observed|reviewed|resolved|switched|tested|testing|updated|verified)\b/i
    .test(value.trim());
}

function isLowValueOutcomeStatusClaim(value: string) {
  const text = value.toLowerCase();
  return (
    /\ball good(?: now)?\b/i.test(text) ||
    /\b(issue|task|fix|route fix|route|request|requests?)\b.+\b(investigated|investigation)\b/i
      .test(text) ||
    /\b(investigated|investigation)\b.+\b(issue|task|fix|route|request|requests?)\b/i
      .test(text)
  );
}

function hasChineseVisibleMechanism(value: string) {
  return (
    /(?:在|于)?\s*(?:request setup|请求设置|请求初始化).{0,8}前.{0,24}(?:注册|移动|放置|等待|校验|验证|加载|导入|设置|移除|清理|解析|规范化|去重|剥离|去掉)/i
      .test(value) ||
    /(?:注册|移动|放置|等待|校验|验证|加载|导入|设置|移除|清理|解析|规范化|去重|剥离|去掉).{0,40}(?:request setup\s*前|请求设置前|请求初始化前|before request setup)/i
      .test(value) ||
    /(?:避免|防止).{0,30}(?:http\s*[45]\d\d|econrefused|typeerror|syntaxerror|stale|重复|缺失|泄露|回退|错误)/i
      .test(value) &&
    /(?:注册|移动|放置|等待|校验|验证|加载|导入|设置|移除|清理|解析|规范化|去重|剥离|去掉)/i
      .test(value)
  );
}

function isChineseVisibleStatusShell(value: string) {
  if (!/[\u3400-\u9fff]/.test(value)) return false;
  const hasCompletionShell =
    /问题处理完|处理完成|处理完毕|修复好了|修好了|已经处理|已处理|回归正常|恢复正常|更稳定|不再返回|已解决|解决完成|已完成|修复完成|修复已完成/i
      .test(value);
  const hasWorkLogShell =
    /这次.{0,20}(?:修复|处理).{0,8}(?:好了|完成|完毕)|(?:接口|问题|路由|请求).{0,12}(?:更稳定|回归正常|恢复正常)/i
      .test(value);
  return (hasCompletionShell || hasWorkLogShell) && !hasChineseVisibleMechanism(value);
}

function isMetaReusableClaim(value: string) {
  const text = value.toLowerCase();
  const hasMetaClaim =
    /\b(reusable lesson|reusable note|reusable fix|future work|future tasks?|this note captures|captures a reusable|for future work|for future tasks?)\b/i
      .test(text);
  return hasMetaClaim && !hasConcreteMechanism(text);
}

function isGenericVisibleBoilerplateClaim(value: string) {
  const text = value.toLowerCase();
  const hasGenericReliabilityFix =
    /\b(?:backend|api|server)?\s*reliability\s+fix\b/i.test(text) ||
    /\bfix\b.+\breliability\b/i.test(text) ||
    /\breliability improvement\b/i.test(text) ||
    /\bimprove\b.+\b(reliability|correctness)\b/i.test(text) ||
    /\b(reliability|correctness)\b.+\bfuture requests?\b/i.test(text);
  const hasGenericFutureFailure =
    /\bfuture failure prevention\b/i.test(text) ||
    /\b(?:avoid|prevent|prevents?|prevention)\b.+\bfuture failures?\b/i.test(text) ||
    /\bfuture failures?\b.+\bexpected workflow\b/i.test(text);
  const hasGenericReleaseValidation =
    /\bvalidate behavior\b/i.test(text) ||
    /\balways validate behavior before release\b/i.test(text) ||
    /\bvalidate behavior\b.+\bbefore release\b/i.test(text) ||
    isGenericReleaseValidationClaim(text);
  const hasGenericResolvedInvestigation =
    /\bissue resolved after investigation\b/i.test(text) ||
    /\bresolved after investigation\b/i.test(text) ||
    /\bissue was resolved after investigation(?: and testing)?\b/i.test(text);
  return hasGenericResolvedInvestigation || (
    hasGenericReliabilityFix ||
    hasGenericFutureFailure ||
    hasGenericReleaseValidation
  ) && !hasConcreteMechanism(text);
}

function isGenericReleaseValidationClaim(value: string) {
  const text = value.toLowerCase();
  return (
    /\bvalidat(?:e|ing|ion)\b.+\b(api requests?|requests?)\b.+\bbefore release\b/i.test(text) ||
    /\b(api requests?|requests?)\b.+\bvalidat(?:e|ing|ion)\b.+\bbefore release\b/i.test(text)
  );
}

function isVisibleStatusSnapshotText(value: string) {
  const hasPassStatus = /\b(build|npm test|tests?|testing|typecheck|lint|ci)\b.+\bpassed\b/i
    .test(value);
  const hasSuccessStatus =
    /\b(ci green|ci completed successfully|tests? succeeded|testing succeeded|verification succeeded|build succeeded|typecheck succeeded|lint succeeded)\b/i
      .test(value) ||
    /\b(typecheck|lint|ci|build|tests?|testing|verification)\b.+\bcompleted successfully\b/i
      .test(value);
  const hasHttpSuccessStatus =
    /\b(?:now\s+)?(?:returns?|responds?)(?:\s+with)?\s+(?:http\s*)?2\d\d\b/i
      .test(value) ||
    /\bhttp\s*2\d\d\b.+\b(after|now|success|succeeded|passed|ok|works?|working)\b/i
      .test(value);
  const hasStatusVerb = /\b(checked|noted|observed|reviewed|resolved|tested|testing passed|verified|verification|current|status)\b/i
    .test(value);
  const hasChineseStatus =
    /已验证|验证通过|测试通过|构建通过|编译通过|类型检查通过|检查通过|已修复|修复已验证|ci\s*通过|持续集成通过/i
      .test(value) ||
    isChineseVisibleStatusShell(value) ||
    /(?:提高|提升).{0,12}(?:可靠性|正确性)|(?:可靠性|正确性).{0,12}(?:提高|提升)/
      .test(value);
  const hasStatusObject =
    /\b(node_env|env|environment|production|local|testing|server readiness|fastify readiness|api requests?|package version|version|generated dist output|dist output)\b/i
      .test(value);
  return hasPassStatus ||
    hasSuccessStatus ||
    hasHttpSuccessStatus ||
    hasChineseStatus ||
    ((hasStatusVerb && hasStatusObject) && !hasStrongReusableMechanism(value));
}

function conclusionText(
  note: MaterializedTaskMemoryNote,
  label: 'root cause' | 'resolution' | 'pattern' | 'decision' | 'pitfall',
) {
  const pattern = new RegExp(`^\\s*${label}:\\s*(.+)$`, 'i');
  return note.key_conclusions
    .map((item) => pattern.exec(item)?.[1]?.trim())
    .filter((item): item is string => Boolean(item));
}

function hasVisibleConcreteFixSignal(note: MaterializedTaskMemoryNote) {
  const rootCauses = conclusionText(note, 'root cause');
  const resolutions = conclusionText(note, 'resolution');
  return (
    rootCauses.some((item) => hasVisibleRootCauseConclusionQuality(item)) &&
    resolutions.some((item) => hasVisibleResolutionConclusionQuality(item))
  );
}

function hasVisibleRootCauseConclusionQuality(value: string) {
  return (
    hasNonPlaceholderMeaningfulText(value) &&
    hasStrongRootCauseSignal(value) &&
    !isFirstPersonDiaryClaim(value) &&
    !isVagueGenericFixClaim(value)
  );
}

function hasVisibleResolutionConclusionQuality(value: string) {
  return hasActionableResolution(value) && !isFirstPersonDiaryClaim(value);
}

function hasVisibleStructuredSignal(note: MaterializedTaskMemoryNote) {
  return [
    ...conclusionText(note, 'pattern'),
    ...conclusionText(note, 'decision'),
    ...conclusionText(note, 'pitfall'),
  ].some((item) => hasConcreteTransferableText(item));
}

function hasVisibleConclusionBoilerplate(note: MaterializedTaskMemoryNote) {
  return note.key_conclusions.some((item) => isLowQualityVisibleConclusion(item));
}

function isLowQualityVisibleConclusion(value: string) {
  const labelMatch = /^\s*(root cause|resolution|pattern|decision|pitfall|takeaway|observation|build|test|error signature):\s*/i
    .exec(value);
  const label = labelMatch?.[1]?.toLowerCase();
  const body = value.slice(labelMatch?.[0]?.length ?? 0);
  const shouldApplyGenericLessonGate = label !== 'root cause' && label !== 'resolution';
  const hasLowQualityBody =
    isPlaceholderText(value) ||
    isPlaceholderText(body) ||
    isFirstPersonDiaryClaim(value) ||
    isFirstPersonDiaryClaim(body) ||
    isVisibleWorkLogClaim(body) ||
    isVisibleStatusSnapshotText(body) ||
    isLowValueOutcomeStatusClaim(value) ||
    isLowValueOutcomeStatusClaim(body) ||
    isMetaReusableClaim(value) ||
    isMetaReusableClaim(body) ||
    (shouldApplyGenericLessonGate && isVagueGenericLesson(body)) ||
    isVagueGenericFixClaim(body) ||
    isGenericVisibleBoilerplateClaim(value) ||
    isGenericVisibleBoilerplateClaim(body);
  if (label === 'root cause') {
    return hasLowQualityBody || !hasVisibleRootCauseConclusionQuality(body);
  }
  if (label === 'resolution') {
    return hasLowQualityBody || !hasVisibleResolutionConclusionQuality(body);
  }
  return hasLowQualityBody || (shouldApplyGenericLessonGate && !hasConcreteConclusionValue(body));
}

function hasConcreteConclusionValue(value: string) {
  if (isLowValueOutcomeStatusClaim(value)) return false;
  if (isGenericReleaseValidationClaim(value)) return false;
  return (
    hasVisibleConcreteContent(value) ||
    hasConcreteTransferableText(value) ||
    hasFailureOrConsequenceSignal(value)
  );
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
    'verified',
    'verification',
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
    /\b(current|checked|verified|verification|checks?|status|local|node_env|env|environment|production|package version|version|dist output|generated dist output)\b/i
      .test(text);
  return hasStatusShape && !hasStrongReusableMechanism(text);
}

function hasStrongReusableMechanism(value: string) {
  return /\b(normalize|normalizing|parse|parsing|diverge|diverged|default data directory|race|raced|orphan|dedupe|deduplicate|foreign_keys|cascade|nulling|source_run_key)\b/i
    .test(value);
}

function hasLowQualityCodeSnippets(note: MaterializedTaskMemoryNote) {
  return Boolean(note.raw_payload.code_snippets?.some((snippet) => !hasUsefulCodeSnippet(snippet)));
}

function hasUsefulCodeSnippet(
  snippet: NonNullable<MaterializedTaskMemoryNote['raw_payload']['code_snippets']>[number],
) {
  const language = snippet.language.trim().toLowerCase();
  const code = snippet.code.trim();
  const description = snippet.description?.trim() ?? '';
  if (!hasMeaningfulText(code, 4, 4) || isPlaceholderText(code)) return false;
  if (isPlaceholderFunctionCallSnippet(code)) return false;
  if (!hasNonPlaceholderMeaningfulText(description, 12, 8)) return false;

  const combined = `${language}\n${code}\n${description}`;
  const hasConcreteCodeShape =
    /\b(pragma|select|insert|update|delete|create table)\b/i.test(code) ||
    /\b(const|let|var|function|return|import|export|class)\b/i.test(code) ||
    /\b[\w.]+\s*\([^)]*\S[^)]*\)/.test(code) ||
    /\{[^}]+[:=][^}]+\}/.test(code) ||
    /"[^"]+"\s*:/.test(code) ||
    /\b[\w.]+\s*[:=]\s*(?:"[^"]+"|'[^']+'|`[^`]+`|\d+|true|false|\/[\w./-]+|\w+\([^)]*\))/
      .test(code);
  const hasConcreteEvidence =
    /\b(pragma\s+foreign_keys|foreign_keys|json\.parse|z\.object|z\.array|response_item\.content|data_dir|node_env|source_run_key|note_tags)\b/i
      .test(combined) ||
    hasSchemaArrayEvidence(combined) ||
    hasJsonParsingEvidence(combined) ||
    hasProviderBaseUrlEvidence(combined) ||
    hasImportContentArrayEvidence(combined) ||
    hasContentSanitizationEvidence(combined) ||
    hasPersistenceSnapshotEvidence(combined) ||
    hasIndexConsistencyEvidence(combined) ||
    hasImportDedupeEvidence(combined) ||
    hasDurableEngineeringEvidence(combined) ||
    hasSpecificEvidence(combined);
  return hasConcreteEvidence && hasConcreteCodeShape;
}

function isPlaceholderFunctionCallSnippet(code: string) {
  const normalized = normalizeSnippetForPlaceholderCall(code);
  const match = /^([A-Za-z_$][\w$]*)\s*\(([^()]*)\)$/.exec(normalized);
  if (!match) return false;

  const functionName = match[1].toLowerCase();
  const placeholderNames = /^(fix|handle|dothing|do_thing|process|update|set|parse|normalize|prune|strip|sanitize)$/i;
  if (!placeholderNames.test(functionName)) return false;

  const args = match[2].trim();
  if (!args) return true;
  return args
    .split(',')
    .every((arg) => isSimplePlaceholderArgument(arg.trim()));
}

function normalizeSnippetForPlaceholderCall(code: string) {
  let normalized = code.trim().replace(/;$/, '').trim();
  for (let i = 0; i < 4; i += 1) {
    const next = normalized
      .replace(/^return\s+/i, '')
      .replace(/^await\s+/i, '')
      .replace(/^(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*/i, '')
      .trim();
    if (next === normalized) break;
    normalized = next.replace(/;$/, '').trim();
  }
  return normalized;
}

function isSimplePlaceholderArgument(value: string) {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(value) ||
    /^["'`][^"'`]+["'`]$/.test(value);
}

function hasLowQualityTags(note: MaterializedTaskMemoryNote) {
  return note.tags.some((tag) => isLowQualityTag(tag));
}

function normalizeTagForQuality(tag: string) {
  let normalized = tag.trim().toLowerCase();
  for (let i = 0; i < 3; i += 1) {
    normalized = normalized
      .replace(/^#+\s*/, '')
      .replace(/^[`"'“”‘’「」『』《》\[\]()（）【】]+/, '')
      .replace(/[`"'“”‘’「」『』《》\[\]()（）【】]+$/, '')
      .replace(/[.。!！,，;；:：]+$/, '')
      .trim();
  }
  return normalized;
}

function isLowQualityTag(tag: string) {
  const normalized = normalizeTagForQuality(tag);
  if (!normalized || isPlaceholderText(normalized)) return true;
  return /^(fix|bug|issue|bugfix|bug[-_\s]?fix|success|fixed|reliable|reliability|quality|done|verified|test[-_\s]?passed|passed|ok|okay|resolved|working|complete|completed|all[-_\s]?good|status|checked|reviewed|tested|修复|已修复|修复完成|已完成|完成|已验证|验证|测试通过|测试|通过|可靠性|成功|状态|检查|问题|质量)$/i
    .test(normalized);
}

export function validateMaterializedNoteQuality(
  note: MaterializedTaskMemoryNote,
  options: { mode: ValidationMode },
): NoteQualityDecision {
  const warnings: string[] = [];
  const acceptedDurableFix =
    hasDurableFixSignal(note) &&
    hasVisibleConcreteFixSignal(note) &&
    hasVisibleTitleSummaryQuality(note);

  if (!hasMeaningfulText(note.title, 10, 6) || isGenericTitle(note.title)) {
    warnings.push('title');
  }
  if (!hasMeaningfulText(note.summary)) {
    warnings.push('summary');
  }
  if (!note.key_conclusions.some((item) => hasMeaningfulText(item, 16, 10))) {
    warnings.push('key_conclusions');
  }
  if (hasLowQualityCodeSnippets(note)) {
    warnings.push('code_snippets');
  }
  if (hasLowQualityTags(note)) {
    warnings.push('tags');
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
