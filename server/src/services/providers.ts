import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAzure } from '@ai-sdk/azure';
import type { LanguageModel, EmbeddingModel } from 'ai';

export interface ProviderConfig {
  baseURL?: string;
  apiKey?: string;
  model: string;
}

export interface ProviderEntry {
  name: string;
  displayName: string;
  supportsEmbedding: boolean;
  requiresApiKey: boolean;
  requiresBaseURL: boolean;
  createLanguageModel(config: ProviderConfig): LanguageModel;
  createEmbeddingModel?(config: ProviderConfig): EmbeddingModel;
}

const providers = new Map<string, ProviderEntry>();

// Ollama — local inference via OpenAI-compatible endpoint (/v1/)
providers.set('ollama', {
  name: 'ollama',
  displayName: 'Ollama',
  supportsEmbedding: true,
  requiresApiKey: false,
  requiresBaseURL: true,
  createLanguageModel({ baseURL, model }) {
    const url = baseURL || 'http://localhost:11434';
    const ollama = createOpenAI({ baseURL: `${url.replace(/\/+$/, '')}/v1`, apiKey: 'ollama', name: 'ollama' });
    return ollama(model);
  },
  createEmbeddingModel({ baseURL, model }) {
    const url = baseURL || 'http://localhost:11434';
    const ollama = createOpenAI({ baseURL: `${url.replace(/\/+$/, '')}/v1`, apiKey: 'ollama', name: 'ollama' });
    return ollama.textEmbeddingModel(model);
  },
});

// OpenAI
providers.set('openai', {
  name: 'openai',
  displayName: 'OpenAI',
  supportsEmbedding: true,
  requiresApiKey: true,
  requiresBaseURL: false,
  createLanguageModel({ baseURL, apiKey, model }) {
    const openai = createOpenAI({ baseURL, apiKey });
    return openai(model);
  },
  createEmbeddingModel({ baseURL, apiKey, model }) {
    const openai = createOpenAI({ baseURL, apiKey });
    return openai.textEmbeddingModel(model);
  },
});

// Anthropic — native SDK
providers.set('anthropic', {
  name: 'anthropic',
  displayName: 'Anthropic',
  supportsEmbedding: false,
  requiresApiKey: true,
  requiresBaseURL: false,
  createLanguageModel({ apiKey, model }) {
    const anthropic = createAnthropic({ apiKey });
    return anthropic(model);
  },
});

// Google — native SDK
providers.set('google', {
  name: 'google',
  displayName: 'Google AI',
  supportsEmbedding: true,
  requiresApiKey: true,
  requiresBaseURL: false,
  createLanguageModel({ apiKey, model }) {
    const google = createGoogleGenerativeAI({ apiKey });
    return google(model);
  },
  createEmbeddingModel({ apiKey, model }) {
    const google = createGoogleGenerativeAI({ apiKey });
    return google.textEmbeddingModel(model);
  },
});

// Azure OpenAI
providers.set('azure', {
  name: 'azure',
  displayName: 'Azure OpenAI',
  supportsEmbedding: true,
  requiresApiKey: true,
  requiresBaseURL: true,
  createLanguageModel({ baseURL, apiKey, model }) {
    const azure = createAzure({ baseURL, apiKey });
    return azure(model);
  },
  createEmbeddingModel({ baseURL, apiKey, model }) {
    const azure = createAzure({ baseURL, apiKey });
    return azure.textEmbeddingModel(model);
  },
});

// Custom — OpenAI-compatible catch-all
providers.set('custom', {
  name: 'custom',
  displayName: 'Custom (OpenAI Compatible)',
  supportsEmbedding: true,
  requiresApiKey: true,
  requiresBaseURL: true,
  createLanguageModel({ baseURL, apiKey, model }) {
    const custom = createOpenAI({ baseURL, apiKey, name: 'custom' });
    return custom(model);
  },
  createEmbeddingModel({ baseURL, apiKey, model }) {
    const custom = createOpenAI({ baseURL, apiKey, name: 'custom' });
    return custom.textEmbeddingModel(model);
  },
});

export function getProvider(name: string): ProviderEntry {
  const entry = providers.get(name);
  if (!entry) {
    throw new Error(`Unknown provider: "${name}". Available: ${[...providers.keys()].join(', ')}`);
  }
  return entry;
}

export function listProviders(): ProviderEntry[] {
  return [...providers.values()];
}
