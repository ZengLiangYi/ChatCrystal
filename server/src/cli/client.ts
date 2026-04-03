import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFileSync, readFileSync, existsSync, unlinkSync, openSync, mkdirSync } from 'node:fs';

export class ServerNotAvailableError extends Error {
  constructor(baseUrl: string) {
    super(`Cannot connect to server at ${baseUrl}. Start manually with: crystal serve`);
    this.name = 'ServerNotAvailableError';
  }
}

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export class CrystalClient {
  private serverChecked = false;

  constructor(private baseUrl: string = 'http://localhost:3721') {}

  async ensureServer(): Promise<void> {
    if (this.serverChecked) return;

    if (await this.isServerRunning()) {
      this.serverChecked = true;
      return;
    }

    const started = await this.autoStartServer();
    if (!started) {
      throw new ServerNotAvailableError(this.baseUrl);
    }
    this.serverChecked = true;
  }

  private async isServerRunning(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/status`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async autoStartServer(): Promise<boolean> {
    console.error('Starting server in background...');

    // Resolve the server entry point relative to this file
    // In compiled output: dist/server/src/cli/client.js → dist/server/src/index.js
    const serverEntry = resolve(import.meta.dirname, '../index.js');
    const pidDir = resolve(import.meta.dirname, '../../../../../data');
    try { mkdirSync(pidDir, { recursive: true }); } catch { /* ignore */ }

    // Redirect stdout/stderr to log file (Fastify's pino logger needs a writable stdout)
    const logFile = resolve(pidDir, 'crystal-server.log');
    const logFd = openSync(logFile, 'a');
    const child = spawn(process.execPath, [serverEntry], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env },
    });
    child.unref();
    const pidFile = resolve(pidDir, 'crystal.pid');
    try {
      writeFileSync(pidFile, String(child.pid), 'utf-8');
    } catch {
      // data dir might not exist yet, non-fatal
    }

    // Poll for readiness
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (await this.isServerRunning()) {
        console.error('Server started.');
        return true;
      }
    }

    console.error('Server failed to start within 10 seconds.');
    return false;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    await this.ensureServer();

    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = { method };
    if (body !== undefined) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(url, options);
    } catch (err) {
      throw new ServerNotAvailableError(this.baseUrl);
    }

    const json = await res.json() as { success: boolean; data?: T; error?: string };

    if (!json.success) {
      throw new ApiError(res.status, json.error ?? `Request failed: ${method} ${path}`);
    }

    return json.data as T;
  }

  async status() {
    return this.request<{
      server: boolean;
      database: boolean;
      stats: { totalConversations: number; totalNotes: number; totalTags: number };
      recentNotes: Array<{ id: number; title: string; project_name: string; created_at: string }>;
    }>('GET', '/api/status');
  }

  async importScan(source?: string) {
    return this.request<{
      total: number; imported: number; skipped: number; errors: number;
    }>('POST', '/api/import/scan', source ? { source } : undefined);
  }

  async search(query: string, limit = 10) {
    return this.request<Array<{
      note_id: number; title: string; project_name: string; score: number; tags: string[];
    }>>('GET', `/api/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  async listNotes(options?: { tag?: string; search?: string; offset?: number; limit?: number }) {
    const params = new URLSearchParams();
    if (options?.tag) params.set('tag', options.tag);
    if (options?.search) params.set('search', options.search);
    if (options?.offset) params.set('offset', String(options.offset));
    if (options?.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    return this.request<{
      items: Array<{ id: number; title: string; summary: string; tags: string[]; project_name?: string; created_at: string }>;
      total: number; offset: number; limit: number;
    }>('GET', `/api/notes${qs ? `?${qs}` : ''}`);
  }

  async getNote(id: number) {
    return this.request<{
      id: number; title: string; summary: string;
      key_conclusions: string[]; code_snippets: Array<{ language: string; code: string; description: string }>;
      tags: string[]; project_name: string; created_at: string;
    }>('GET', `/api/notes/${id}`);
  }

  async getNoteRelations(id: number) {
    return this.request<Array<{
      id: number; source_note_id: number; target_note_id: number;
      relation_type: string; confidence: number; description: string | null;
      source_title?: string; target_title?: string;
    }>>('GET', `/api/notes/${id}/relations`);
  }

  async listTags() {
    return this.request<Array<{ id: number; name: string; count: number }>>('GET', '/api/tags');
  }

  async summarize(conversationId: string) {
    return this.request<{ queued: number }>('POST', `/api/conversations/${conversationId}/summarize`);
  }

  async summarizeBatch() {
    return this.request<{ queued: number; total: number }>('POST', '/api/summarize/batch');
  }

  async resetErrors() {
    return this.request<{ reset: number }>('POST', '/api/summarize/reset-errors');
  }

  async getConfig() {
    return this.request<{
      llm: { provider: string; baseURL: string; model: string; hasApiKey: boolean };
      embedding: { provider: string; baseURL: string; model: string; hasApiKey: boolean };
      enabledSources: string[];
    }>('GET', '/api/config');
  }

  async updateConfig(config: { llm?: Record<string, string>; embedding?: Record<string, string>; confirm?: boolean }) {
    return this.request<Record<string, unknown>>('POST', '/api/config', config);
  }

  async testConfig() {
    return this.request<{ connected: boolean; response?: string; error?: string }>('POST', '/api/config/test');
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function readPidFile(dataDir: string): number | null {
  const pidFile = resolve(dataDir, 'crystal.pid');
  if (!existsSync(pidFile)) return null;
  try {
    const pid = Number(readFileSync(pidFile, 'utf-8').trim());
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function removePidFile(dataDir: string): void {
  const pidFile = resolve(dataDir, 'crystal.pid');
  try { unlinkSync(pidFile); } catch { /* ignore */ }
}
