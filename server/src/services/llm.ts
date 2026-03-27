import { createOpenAI } from '@ai-sdk/openai';
import { createOllama } from 'ollama-ai-provider';
import type { LanguageModelV1 } from '@ai-sdk/provider';
import { appConfig } from '../config.js';

/**
 * Create a Vercel AI SDK language model from the app config.
 */
export function getLanguageModel(): LanguageModelV1 {
  const { provider, baseURL, apiKey, model } = appConfig.llm;

  switch (provider) {
    case 'ollama': {
      const ollama = createOllama({ baseURL: `${baseURL}/api` });
      return ollama(model);
    }
    case 'openai': {
      const openai = createOpenAI({ baseURL, apiKey, compatibility: 'strict' });
      return openai(model);
    }
    case 'anthropic':
    case 'google':
    case 'custom': {
      const custom = createOpenAI({
        baseURL,
        apiKey,
        compatibility: 'compatible',
        name: provider,
      });
      return custom(model);
    }
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}
