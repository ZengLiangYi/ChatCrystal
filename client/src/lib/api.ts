const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
	const headers: Record<string, string> = {};
	// Only set Content-Type for requests with body
	if (options?.body) {
		headers["Content-Type"] = "application/json";
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
	if (!json.success) throw new Error(json.error || "Unknown error");
	return json.data;
}

export const api = {
	getStatus: () =>
		request<{
			server: boolean;
			database: boolean;
			stats: {
				totalConversations: number;
				totalNotes: number;
				totalTags: number;
			};
		}>("/status"),

	triggerImport: () =>
		request<{
			total: number;
			imported: number;
			skipped: number;
			errors: number;
		}>("/import/scan", { method: "POST" }),

	getConversations: (params?: {
		source?: string;
		project?: string;
		search?: string;
		offset?: number;
		limit?: number;
	}) => {
		const query = new URLSearchParams();
		if (params?.source) query.set("source", params.source);
		if (params?.project) query.set("project", params.project);
		if (params?.search) query.set("search", params.search);
		if (params?.offset != null) query.set("offset", String(params.offset));
		if (params?.limit != null) query.set("limit", String(params.limit));
		const qs = query.toString();
		return request<{
			items: Record<string, unknown>[];
			total: number;
			offset: number;
			limit: number;
		}>(`/conversations${qs ? `?${qs}` : ""}`);
	},

	getConversation: (id: string) =>
		request<Record<string, unknown>>(`/conversations/${id}`),

	// Notes
	getNotes: (params?: {
		tag?: string;
		search?: string;
		offset?: number;
		limit?: number;
	}) => {
		const query = new URLSearchParams();
		if (params?.tag) query.set("tag", params.tag);
		if (params?.search) query.set("search", params.search);
		if (params?.offset != null) query.set("offset", String(params.offset));
		if (params?.limit != null) query.set("limit", String(params.limit));
		const qs = query.toString();
		return request<{
			items: Record<string, unknown>[];
			total: number;
			offset: number;
			limit: number;
		}>(`/notes${qs ? `?${qs}` : ""}`);
	},

	getNote: (id: number) => request<Record<string, unknown>>(`/notes/${id}`),

	summarize: (conversationId: string) =>
		request<{ noteId: number }>(`/conversations/${conversationId}/summarize`, {
			method: "POST",
		}),

	summarizeBatch: () =>
		request<{ queued: number; total: number }>("/summarize/batch", {
			method: "POST",
		}),

	getTags: () =>
		request<{ id: number; name: string; count: number }[]>("/tags"),

	search: (q: string, limit = 10, expand = false) =>
		request<
			{
				note_id: number;
				conversation_id: string;
				title: string;
				project_name: string;
				score: number;
				tags: string[];
				via_relation: string | null;
			}[]
		>(
			`/search?q=${encodeURIComponent(q)}&limit=${limit}${expand ? "&expand=true" : ""}`,
		),

	embedBatch: () =>
		request<{ queued: number }>("/embeddings/batch", { method: "POST" }),

	getQueueStatus: () =>
		request<{
			total: number;
			completed: number;
			failed: number;
			active: number;
			tasks: {
				id: string;
				title: string;
				status: "queued" | "processing" | "completed" | "failed";
				error?: string;
				addedAt: number;
				startedAt?: number;
				finishedAt?: number;
			}[];
		}>("/queue/status"),

	cancelQueue: () =>
		request<{ cancelled: number }>("/queue/cancel", { method: "POST" }),

	// Relations
	getNoteRelations: (noteId: number) =>
		request<
			{
				id: number;
				source_note_id: number;
				target_note_id: number;
				relation_type: string;
				confidence: number;
				description: string | null;
				created_by: string;
				created_at: string;
				source_title: string;
				target_title: string;
			}[]
		>(`/notes/${noteId}/relations`),

	createRelation: (
		noteId: number,
		data: {
			target_note_id: number;
			relation_type: string;
			description?: string;
		},
	) =>
		request<Record<string, unknown>>(`/notes/${noteId}/relations`, {
			method: "POST",
			body: JSON.stringify(data),
		}),

	deleteRelation: (relationId: number) =>
		request<void>(`/relations/${relationId}`, { method: "DELETE" }),

	discoverRelations: (noteId: number) =>
		request<Record<string, unknown>[]>(`/notes/${noteId}/discover-relations`, {
			method: "POST",
		}),

	batchDiscoverRelations: () =>
		request<{ queued: number }>("/relations/batch-discover", {
			method: "POST",
		}),

	getRelationGraph: (project?: string) => {
		const qs = project ? `?project=${encodeURIComponent(project)}` : "";
		return request<{
			nodes: {
				id: number;
				title: string;
				project_name: string;
				tags: string[];
			}[];
			edges: {
				source: number;
				target: number;
				type: string;
				confidence: number;
			}[];
		}>(`/relations/graph${qs}`);
	},

	getConfig: () =>
		request<{
			llm: {
				provider: string;
				baseURL: string;
				model: string;
				hasApiKey: boolean;
			};
			embedding: {
				provider: string;
				baseURL: string;
				model: string;
				hasApiKey: boolean;
			};
			sources: {
				name: string;
				displayName: string;
				dataDir: string;
				conversationCount: number;
			}[];
			enabledSources: string[];
			claudeProjectsDir: string;
		}>("/config"),

	getProviders: () =>
		request<
			{
				name: string;
				displayName: string;
				supportsEmbedding: boolean;
				requiresApiKey: boolean;
				requiresBaseURL: boolean;
			}[]
		>("/providers"),

	updateConfig: (data: {
		llm?: {
			provider?: string;
			baseURL?: string;
			apiKey?: string;
			model?: string;
		};
		embedding?: {
			provider?: string;
			baseURL?: string;
			apiKey?: string;
			model?: string;
		};
		enabledSources?: string[];
		confirm?: boolean;
	}) =>
		request<{
			requiresConfirm?: boolean;
			warnings?: string[];
			llm?: {
				provider: string;
				baseURL: string;
				model: string;
				hasApiKey: boolean;
			};
			embedding?: {
				provider: string;
				baseURL: string;
				model: string;
				hasApiKey: boolean;
			};
		}>("/config", { method: "POST", body: JSON.stringify(data) }),

	testConfig: () =>
		request<{
			connected: boolean;
			response?: string;
			error?: string;
			llm: { connected: boolean; response?: string; error?: string };
			embedding: { connected: boolean; error?: string };
		}>(
			"/config/test",
			{ method: "POST" },
		),
};
