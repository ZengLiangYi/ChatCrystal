import { appConfig } from '../config.js';

type EnvLike = Record<string, string | undefined>;

type ProviderWarningInput = {
  cloudMode: boolean;
  llm: { provider: string; baseURL?: string; model: string };
  embedding: { provider: string; baseURL?: string; model: string };
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const PUBLIC_API_PATHS = new Set([
  '/api/health',
  '/api/setup/status',
  '/api/setup/complete',
  '/api/auth/verify',
]);

export function isCloudModeForEnv(env: EnvLike): boolean {
  return env.CHATCRYSTAL_CLOUD_MODE === 'true' || Boolean(env.CHATCRYSTAL_API_TOKEN?.trim());
}

export function isCloudMode(): boolean {
  return isCloudModeForEnv(process.env);
}

export function isLocalBaseUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return LOCAL_HOSTS.has(url.hostname) || LOCAL_HOSTS.has(url.host);
  } catch {
    return false;
  }
}

export function isPublicApiPath(path: string): boolean {
  const pathname = path.split('?', 1)[0] ?? path;
  return PUBLIC_API_PATHS.has(pathname);
}

function hasContainerLocalBaseUrl(baseURL?: string): boolean {
  if (!baseURL) return false;
  try {
    const url = new URL(baseURL);
    return url.protocol.startsWith('http') && LOCAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function getProviderWarningsForTest(input: ProviderWarningInput): string[] {
  if (!input.cloudMode) return [];

  const warnings: string[] = [];
  if (input.llm.provider === 'ollama' && hasContainerLocalBaseUrl(input.llm.baseURL)) {
    warnings.push(
      'LLM provider points to localhost from inside the container. Use host.docker.internal, a remote HTTPS API, or a trusted network Ollama URL.',
    );
  }
  if (input.embedding.provider === 'ollama' && hasContainerLocalBaseUrl(input.embedding.baseURL)) {
    warnings.push(
      'Embedding provider points to localhost from inside the container. Use host.docker.internal, a remote HTTPS API, or a trusted network Ollama URL.',
    );
  }

  return warnings;
}

export function getProviderWarnings(): string[] {
  return getProviderWarningsForTest({
    cloudMode: isCloudMode(),
    llm: appConfig.llm,
    embedding: appConfig.embedding,
  });
}
