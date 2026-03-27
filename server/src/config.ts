import { config } from 'dotenv';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

config({ path: resolve(import.meta.dirname, '../../.env') });

function resolveHome(p: string): string {
  if (p.startsWith('~')) {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

export const appConfig = {
  port: Number(process.env.PORT) || 3721,
  dataDir: resolve(import.meta.dirname, '../../', process.env.DATA_DIR || './data'),

  claudeProjectsDir: resolveHome(
    process.env.CLAUDE_PROJECTS_DIR || '~/.claude/projects',
  ),

  llm: {
    provider: (process.env.LLM_PROVIDER || 'ollama') as string,
    baseURL: process.env.LLM_BASE_URL || 'http://localhost:11434',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'qwen2.5:7b',
  },

  embedding: {
    provider: (process.env.EMBEDDING_PROVIDER || 'ollama') as string,
    baseURL: process.env.EMBEDDING_BASE_URL || 'http://localhost:11434',
    apiKey: process.env.EMBEDDING_API_KEY || '',
    model: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
  },
} as const;
