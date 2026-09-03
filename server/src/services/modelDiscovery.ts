export type ModelDiscoveryTarget = 'llm' | 'embedding';

export type ModelDiscoveryProvider =
  | 'ollama'
  | 'openai'
  | 'orcarouter'
  | 'anthropic'
  | 'google'
  | 'azure'
  | 'custom';

export type ModelDiscoveryErrorCode =
  | 'missing_api_key'
  | 'missing_base_url'
  | 'provider_unsupported'
  | 'endpoint_not_found'
  | 'auth_failed'
  | 'timeout'
  | 'parse_failed'
  | 'request_failed';

export type DiscoveredModel = {
  id: string;
  ownedBy: string | null;
};

export type ModelDiscoveryInput = {
  target: ModelDiscoveryTarget;
  provider: string;
  baseURL?: string;
  apiKey?: string;
};

type FetchLike = typeof fetch;

type ModelDiscoveryDeps = {
  fetch?: FetchLike;
};

type OpenAIModelsResponse = {
  data?: {
    id?: unknown;
    owned_by?: unknown;
    ownedBy?: unknown;
  }[];
};

type OllamaTagsResponse = {
  models?: {
    name?: unknown;
  }[];
};

type AnthropicModelsResponse = {
  data?: {
    id?: unknown;
  }[];
};

type GoogleModelsResponse = {
  models?: {
    name?: unknown;
  }[];
};

const FETCH_TIMEOUT_MS = 15_000;
const ERROR_BODY_MAX_CHARS = 512;
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const ORCAROUTER_BASE_URL = 'https://api.orcarouter.ai/v1';
const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';
const GOOGLE_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const KNOWN_COMPAT_SUFFIXES = [
  '/api/claudecode',
  '/api/anthropic',
  '/apps/anthropic',
  '/api/coding',
  '/claudecode',
  '/anthropic',
  '/step_plan',
  '/coding',
  '/claude',
];

export class ModelDiscoveryError extends Error {
  readonly code: ModelDiscoveryErrorCode;

  constructor(code: ModelDiscoveryErrorCode, message: string) {
    super(message);
    this.name = 'ModelDiscoveryError';
    this.code = code;
  }
}

export async function discoverProviderModels(
  input: ModelDiscoveryInput,
  deps: ModelDiscoveryDeps = {},
): Promise<DiscoveredModel[]> {
  const fetchImpl = deps.fetch ?? fetch;
  const provider = input.provider as ModelDiscoveryProvider;

  switch (provider) {
    case 'ollama':
      return discoverOllamaModels(input, fetchImpl);
    case 'openai':
      return discoverOpenAICompatibleModels(
        input.baseURL?.trim() || DEFAULT_OPENAI_BASE_URL,
        requireApiKey(input),
        fetchImpl,
      );
    case 'orcarouter':
      return discoverOpenAICompatibleModels(
        ORCAROUTER_BASE_URL,
        requireApiKey(input),
        fetchImpl,
      );
    case 'custom':
      return discoverOpenAICompatibleModels(
        requireBaseURL(input),
        requireApiKey(input),
        fetchImpl,
      );
    case 'anthropic':
      return discoverAnthropicModels(requireApiKey(input), fetchImpl);
    case 'google':
      return discoverGoogleModels(requireApiKey(input), fetchImpl);
    case 'azure':
      throw new ModelDiscoveryError(
        'provider_unsupported',
        'Azure OpenAI model discovery is not supported yet.',
      );
    default:
      throw new ModelDiscoveryError(
        'provider_unsupported',
        `Provider "${input.provider}" does not support model discovery.`,
      );
  }
}

export function buildOpenAICompatibleModelUrlCandidates(baseURL: string): string[] {
  const trimmed = baseURL.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new ModelDiscoveryError('missing_base_url', 'Base URL is required.');
  }

  const candidates: string[] = [];
  if (endsWithVersionSegment(trimmed)) {
    candidates.push(`${trimmed}/models`);
    if (!trimmed.endsWith('/v1')) {
      candidates.push(`${trimmed}/v1/models`);
    }
  } else {
    candidates.push(`${trimmed}/v1/models`);
  }

  const stripped = stripCompatSuffix(trimmed);
  if (stripped) {
    const root = stripped.replace(/\/+$/, '');
    if (root && root.includes('://')) {
      candidates.push(`${root}/v1/models`);
      candidates.push(`${root}/models`);
    }
  }

  return unique(candidates);
}

function requireApiKey(input: ModelDiscoveryInput): string {
  const apiKey = input.apiKey?.trim() ?? '';
  if (!apiKey) {
    throw new ModelDiscoveryError('missing_api_key', 'API Key is required.');
  }
  return apiKey;
}

function requireBaseURL(input: ModelDiscoveryInput): string {
  const baseURL = input.baseURL?.trim() ?? '';
  if (!baseURL) {
    throw new ModelDiscoveryError('missing_base_url', 'Base URL is required.');
  }
  return baseURL;
}

async function discoverOllamaModels(
  input: ModelDiscoveryInput,
  fetchImpl: FetchLike,
): Promise<DiscoveredModel[]> {
  const baseURL = input.baseURL?.trim() || DEFAULT_OLLAMA_BASE_URL;
  const url = `${baseURL.replace(/\/+$/, '')}/api/tags`;
  const response = await fetchWithTimeout(fetchImpl, url);
  const data = await parseJson<OllamaTagsResponse>(response);
  return sortModels(
    (data.models ?? [])
      .map((model) => cleanModelId(model.name))
      .filter((id): id is string => Boolean(id))
      .map((id) => ({ id, ownedBy: null })),
  );
}

async function discoverOpenAICompatibleModels(
  baseURL: string,
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<DiscoveredModel[]> {
  const candidates = buildOpenAICompatibleModelUrlCandidates(baseURL);
  let lastEndpointError: string | null = null;

  for (const url of candidates) {
    const response = await fetchWithTimeout(fetchImpl, url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (response.ok) {
      const data = await parseJson<OpenAIModelsResponse>(response);
      return sortModels(
        (data.data ?? [])
          .map((model) => {
            const id = cleanModelId(model.id);
            if (!id) return null;
            return {
              id,
              ownedBy: cleanOwnedBy(model.owned_by ?? model.ownedBy),
            };
          })
          .filter((model): model is DiscoveredModel => Boolean(model)),
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new ModelDiscoveryError(
        'auth_failed',
        await describeHttpFailure(response, 'API Key is invalid or lacks permission.'),
      );
    }

    if (response.status === 404 || response.status === 405) {
      lastEndpointError = await describeHttpFailure(response, 'Models endpoint was not found.');
      continue;
    }

    throw new ModelDiscoveryError(
      'request_failed',
      await describeHttpFailure(response, 'Model discovery request failed.'),
    );
  }

  throw new ModelDiscoveryError(
    'endpoint_not_found',
    lastEndpointError ?? 'No reachable models endpoint found.',
  );
}

async function discoverAnthropicModels(
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<DiscoveredModel[]> {
  const response = await fetchWithTimeout(fetchImpl, ANTHROPIC_MODELS_URL, {
    headers: {
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
  });
  await assertSuccessfulResponse(response);
  const data = await parseJson<AnthropicModelsResponse>(response);
  return sortModels(
    (data.data ?? [])
      .map((model) => cleanModelId(model.id))
      .filter((id): id is string => Boolean(id))
      .map((id) => ({ id, ownedBy: 'anthropic' })),
  );
}

async function discoverGoogleModels(
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<DiscoveredModel[]> {
  const url = new URL(GOOGLE_MODELS_URL);
  url.searchParams.set('key', apiKey);
  const response = await fetchWithTimeout(fetchImpl, url.toString());
  await assertSuccessfulResponse(response);
  const data = await parseJson<GoogleModelsResponse>(response);
  return sortModels(
    (data.models ?? [])
      .map((model) => cleanModelId(model.name)?.replace(/^models\//, ''))
      .filter((id): id is string => Boolean(id))
      .map((id) => ({ id, ownedBy: 'google' })),
  );
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetchImpl(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new ModelDiscoveryError('timeout', 'Model discovery request timed out.');
    }

    throw new ModelDiscoveryError(
      'request_failed',
      error instanceof Error ? error.message : 'Model discovery request failed.',
    );
  }
}

async function assertSuccessfulResponse(response: Response): Promise<void> {
  if (response.ok) return;

  if (response.status === 401 || response.status === 403) {
    throw new ModelDiscoveryError(
      'auth_failed',
      await describeHttpFailure(response, 'API Key is invalid or lacks permission.'),
    );
  }
  if (response.status === 404 || response.status === 405) {
    throw new ModelDiscoveryError(
      'endpoint_not_found',
      await describeHttpFailure(response, 'Models endpoint was not found.'),
    );
  }

  throw new ModelDiscoveryError(
    'request_failed',
    await describeHttpFailure(response, 'Model discovery request failed.'),
  );
}

async function parseJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new ModelDiscoveryError(
      'parse_failed',
      error instanceof Error ? `Failed to parse model list response: ${error.message}` : 'Failed to parse model list response.',
    );
  }
}

async function describeHttpFailure(response: Response, fallback: string): Promise<string> {
  const body = truncateBody(await response.text().catch(() => ''));
  return body ? `HTTP ${response.status}: ${body}` : `HTTP ${response.status}: ${fallback}`;
}

function truncateBody(body: string): string {
  if (body.length <= ERROR_BODY_MAX_CHARS) return body;
  return `${body.slice(0, ERROR_BODY_MAX_CHARS)}...`;
}

function cleanModelId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function cleanOwnedBy(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function sortModels(models: DiscoveredModel[]): DiscoveredModel[] {
  const seen = new Set<string>();
  const uniqueModels: DiscoveredModel[] = [];

  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    uniqueModels.push(model);
  }

  return uniqueModels.sort((a, b) => a.id.localeCompare(b.id));
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function stripCompatSuffix(baseURL: string): string | null {
  for (const suffix of KNOWN_COMPAT_SUFFIXES) {
    if (baseURL.endsWith(suffix)) {
      return baseURL.slice(0, -suffix.length);
    }
  }
  return null;
}

function endsWithVersionSegment(url: string): boolean {
  const last = url.split('/').at(-1) ?? '';
  const digits = last.startsWith('v') ? last.slice(1) : '';
  return Boolean(digits) && [...digits].every((char) => char >= '0' && char <= '9');
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return true;
  }

  return error instanceof Error && /timeout|timed out/i.test(error.message);
}
