const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  // Only set Content-Type for requests with body
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, {
    headers,
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Unknown error');
  return json.data;
}

export const api = {
  getStatus: () => request<{
    server: boolean;
    database: boolean;
    stats: { totalConversations: number; totalNotes: number; totalTags: number };
  }>('/status'),

  triggerImport: () => request<{
    total: number; imported: number; skipped: number; errors: number;
  }>('/import/scan', { method: 'POST' }),

  getConversations: (params?: {
    source?: string; project?: string; search?: string;
    offset?: number; limit?: number;
  }) => {
    const query = new URLSearchParams();
    if (params?.source) query.set('source', params.source);
    if (params?.project) query.set('project', params.project);
    if (params?.search) query.set('search', params.search);
    if (params?.offset != null) query.set('offset', String(params.offset));
    if (params?.limit != null) query.set('limit', String(params.limit));
    const qs = query.toString();
    return request<{
      items: Record<string, unknown>[];
      total: number; offset: number; limit: number;
    }>(`/conversations${qs ? `?${qs}` : ''}`);
  },

  getConversation: (id: string) =>
    request<Record<string, unknown>>(`/conversations/${id}`),

  // Notes
  getNotes: (params?: { tag?: string; search?: string; offset?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.tag) query.set('tag', params.tag);
    if (params?.search) query.set('search', params.search);
    if (params?.offset != null) query.set('offset', String(params.offset));
    if (params?.limit != null) query.set('limit', String(params.limit));
    const qs = query.toString();
    return request<{
      items: Record<string, unknown>[];
      total: number; offset: number; limit: number;
    }>(`/notes${qs ? `?${qs}` : ''}`);
  },

  getNote: (id: number) =>
    request<Record<string, unknown>>(`/notes/${id}`),

  summarize: (conversationId: string) =>
    request<{ noteId: number }>(`/conversations/${conversationId}/summarize`, { method: 'POST' }),

  summarizeBatch: () =>
    request<{ queued: number; total: number }>('/summarize/batch', { method: 'POST' }),

  getTags: () =>
    request<{ id: number; name: string; count: number }[]>('/tags'),

  search: (q: string, limit = 10) =>
    request<{
      note_id: number; conversation_id: string; title: string;
      project_name: string; score: number; tags: string[];
    }[]>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  embedBatch: () =>
    request<{ queued: number }>('/embeddings/batch', { method: 'POST' }),

  getQueueStatus: () =>
    request<{
      total: number; completed: number; failed: number; active: number;
      tasks: { id: string; title: string; status: 'queued' | 'processing' | 'completed' | 'failed'; error?: string; addedAt: number; startedAt?: number; finishedAt?: number }[];
    }>('/queue/status'),

  cancelQueue: () =>
    request<{ cancelled: number }>('/queue/cancel', { method: 'POST' }),

  getConfig: () =>
    request<{
      llm: { provider: string; baseURL: string; model: string; hasApiKey: boolean };
      embedding: { provider: string; baseURL: string; model: string };
      claudeProjectsDir: string;
    }>('/config'),

  getProviders: () =>
    request<{
      name: string; displayName: string; supportsEmbedding: boolean;
      requiresApiKey: boolean; requiresBaseURL: boolean;
    }[]>('/providers'),

  updateConfig: (data: {
    llm?: { provider?: string; baseURL?: string; apiKey?: string; model?: string };
    embedding?: { provider?: string; baseURL?: string; apiKey?: string; model?: string };
    confirm?: boolean;
  }) =>
    request<{
      requiresConfirm?: boolean;
      warnings?: string[];
      llm?: { provider: string; baseURL: string; model: string; hasApiKey: boolean };
      embedding?: { provider: string; baseURL: string; model: string };
    }>('/config', { method: 'POST', body: JSON.stringify(data) }),

  testConfig: () =>
    request<{ connected: boolean; response?: string; error?: string }>('/config/test', { method: 'POST' }),
};
