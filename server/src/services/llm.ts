import type { LanguageModel } from 'ai';
import { getProvider } from './providers.js';
import { appConfig } from '../config.js';

export function getLanguageModel(): LanguageModel {
  const { provider, ...config } = appConfig.llm;
  return getProvider(provider).createLanguageModel(config);
}
