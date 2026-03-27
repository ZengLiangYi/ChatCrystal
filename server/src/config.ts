import { config } from 'dotenv';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

config({ path: resolve(import.meta.dirname, '../../.env') });

function resolveHome(p: string): string {
  if (p.startsWith('~')) {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

// Defaults from .env
const envDefaults = {
  port: Number(process.env.PORT) || 3721,
  dataDir: resolve(import.meta.dirname, '../../', process.env.DATA_DIR || './data'),
  claudeProjectsDir: resolveHome(process.env.CLAUDE_PROJECTS_DIR || '~/.claude/projects'),
  llm: {
    provider: process.env.LLM_PROVIDER || 'ollama',
    baseURL: process.env.LLM_BASE_URL || 'http://localhost:11434',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'qwen2.5:7b',
  },
  embedding: {
    provider: process.env.EMBEDDING_PROVIDER || 'ollama',
    baseURL: process.env.EMBEDDING_BASE_URL || 'http://localhost:11434',
    apiKey: process.env.EMBEDDING_API_KEY || '',
    model: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
  },
};

// Load persisted config.json if exists, overlay on env defaults
function loadPersistedConfig() {
  const configPath = resolve(envDefaults.dataDir, 'config.json');
  if (!existsSync(configPath)) return envDefaults;

  try {
    const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    return {
      ...envDefaults,
      llm: { ...envDefaults.llm, ...saved.llm },
      embedding: { ...envDefaults.embedding, ...saved.embedding },
    };
  } catch (err) {
    console.warn('[Config] Failed to load config.json, using .env defaults:', err instanceof Error ? err.message : err);
    return envDefaults;
  }
}

export const appConfig = loadPersistedConfig();

/**
 * Update config in memory and persist to data/config.json.
 */
export function updateConfig(partial: {
  llm?: Partial<typeof appConfig.llm>;
  embedding?: Partial<typeof appConfig.embedding>;
}) {
  if (partial.llm) {
    Object.assign(appConfig.llm, partial.llm);
  }
  if (partial.embedding) {
    Object.assign(appConfig.embedding, partial.embedding);
  }
  persistConfig();
}

function persistConfig() {
  const configPath = resolve(appConfig.dataDir, 'config.json');
  const toSave = {
    llm: { ...appConfig.llm },
    embedding: { ...appConfig.embedding },
  };
  // Don't persist empty apiKeys (keep in .env only)
  if (!toSave.llm.apiKey) delete (toSave.llm as Record<string, unknown>).apiKey;
  if (!toSave.embedding.apiKey) delete (toSave.embedding as Record<string, unknown>).apiKey;

  writeFileSync(configPath, JSON.stringify(toSave, null, 2), 'utf-8');
}
