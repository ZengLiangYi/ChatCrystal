import type {
  MaterializedTaskMemoryNote,
  WriteTaskMemoryPayload,
} from '@chatcrystal/shared';
import type { parseWriteTaskMemoryRequest } from './schemas.js';

type ParsedWriteTaskMemoryRequest = ReturnType<typeof parseWriteTaskMemoryRequest>;

const MAX_EMBEDDED_CODE_SNIPPET_CHARS = 1000;

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed || undefined;
}

function cleanStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map(cleanText)
    .filter((value): value is string => Boolean(value));
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function normalizeTags(tags: unknown): string[] {
  return [...new Set(cleanStringArray(tags).map((tag) => tag.toLowerCase()))].sort();
}

function appendLabeled(target: string[], label: string, values: unknown) {
  for (const value of cleanStringArray(values)) {
    target.push(`${label}: ${value}`);
  }
}

function materializeCodeSnippetEvidence(
  snippet: NonNullable<WriteTaskMemoryPayload['code_snippets']>[number],
): string | undefined {
  const code = cleanText(snippet.code);
  if (!code) return undefined;
  const language = cleanText(snippet.language) ?? 'text';
  return `Code snippet (${language}): ${code.slice(0, MAX_EMBEDDED_CODE_SNIPPET_CHARS)}`;
}

export function materializeTaskMemory(
  request: ParsedWriteTaskMemoryRequest,
  payload: WriteTaskMemoryPayload = request.memory,
): MaterializedTaskMemoryNote {
  const title = cleanText(payload.title) ?? cleanText(request.task.goal) ?? request.task.goal.trim();
  const summary = cleanText(payload.summary) ?? '';
  const keyConclusions: string[] = [
    ...cleanStringArray(payload.key_conclusions),
  ];

  const rootCause = cleanText(payload.root_cause);
  const resolution = cleanText(payload.resolution);
  if (rootCause) keyConclusions.push(`Root cause: ${rootCause}`);
  if (resolution) keyConclusions.push(`Resolution: ${resolution}`);
  appendLabeled(keyConclusions, 'Pitfall', payload.pitfalls);
  appendLabeled(keyConclusions, 'Pattern', payload.reusable_patterns);
  appendLabeled(keyConclusions, 'Decision', payload.decisions);
  appendLabeled(keyConclusions, 'Error signature', payload.error_signatures);

  const codeDescriptions = (payload.code_snippets ?? [])
    .map((snippet) => cleanText(snippet.description))
    .filter((value): value is string => Boolean(value));
  const codeEvidence = (payload.code_snippets ?? [])
    .map(materializeCodeSnippetEvidence)
    .filter((value): value is string => Boolean(value));
  const filesTouched = cleanStringArray(payload.files_touched);
  const tags = normalizeTags(payload.tags);

  const embeddingText = [
    title,
    summary,
    ...dedupe(keyConclusions),
    ...codeDescriptions.map((description) => `Code: ${description}`),
    ...codeEvidence,
    ...filesTouched.map((file) => `File: ${file}`),
    ...tags.map((tag) => `Tag: ${tag}`),
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    title,
    summary,
    key_conclusions: dedupe(keyConclusions),
    embedding_text: embeddingText,
    tags,
    raw_payload: payload,
  };
}
