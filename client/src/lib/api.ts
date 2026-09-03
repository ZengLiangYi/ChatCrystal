import type { DeleteNoteReviewRequest, DeleteNoteReviewResponse } from "@chatcrystal/shared";

const BASE = "/api";
const TOKEN_KEY = "chatcrystal.apiToken";
export const AUTH_CHANGED_EVENT = "chatcrystal-auth-changed";

type DeleteNoteWebRequest = Omit<DeleteNoteReviewRequest, "source"> & { source: "web" };
type ProviderResponse = {
	name: string;
	displayName: string;
	supportsEmbedding: boolean;
	supportsModelDiscovery?: boolean;
	requiresApiKey: boolean;
	requiresBaseURL: boolean;
};

const MODEL_DISCOVERY_SUPPORTED_PROVIDERS = new Set([
	"ollama",
	"openai",
	"orcarouter",
	"anthropic",
	"google",
	"custom",
]);

export class ApiRequestError extends Error {
	status?: number;
	code?: string;

	constructor(message: string, options?: { status?: number; code?: string }) {
		super(message);
		this.name = "ApiRequestError";
		this.status = options?.status;
		this.code = options?.code;
	}
}

export function getStoredToken(): string | null {
	return window.localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
	window.localStorage.setItem(TOKEN_KEY, token);
	window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function clearStoredToken(): void {
	window.localStorage.removeItem(TOKEN_KEY);
	window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
	const headers = new Headers(options?.headers);
	// Only set Content-Type for requests with body
	if (options?.body) {
		headers.set("Content-Type", "application/json");
	}
	const token = getStoredToken();
	if (token) {
		headers.set("Authorization", `Bearer ${token}`);
	}
	const res = await fetch(`${BASE}${path}`, {
		...options,
		headers,
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as {
			error?: string;
			code?: string;
		};
		if (res.status === 401) {
			clearStoredToken();
		}
		throw new ApiRequestError(body.error || `Request failed: ${res.status}`, {
			status: res.status,
			code: body.code,
		});
	}
	const json = (await res.json()) as {
		success: boolean;
		data: T;
		error?: string;
		code?: string;
	};
	if (!json.success) {
		throw new ApiRequestError(json.error || "Unknown error", {
			code: json.code,
		});
	}
	return json.data;
}

export function isProviderModelDiscoverySupported(provider: {
	name: string;
	supportsModelDiscovery?: boolean;
}) {
	return typeof provider.supportsModelDiscovery === "boolean"
		? provider.supportsModelDiscovery
		: MODEL_DISCOVERY_SUPPORTED_PROVIDERS.has(provider.name);
}

function normalizeProviders(providers: ProviderResponse[]) {
	return providers.map((provider) => ({
		...provider,
		supportsModelDiscovery: isProviderModelDiscoverySupported(provider),
	}));
}

export const api = {
	getStatus: () =>
		request<{
			server: boolean;
			database: boolean;
			cloudMode: boolean;
			providerWarnings: string[];
			stats: {
				totalConversations: number;
				totalNotes: number;
				totalTags: number;
			};
		}>("/status"),

	getSetupStatus: () =>
		request<{
			cloudMode: boolean;
			setupRequired: boolean;
			authenticated: boolean;
			providerWarnings: string[];
		}>("/setup/status"),

	completeSetup: (data: { setupCode: string; token: string }) =>
		request<{ authenticated: boolean }>("/setup/complete", {
			method: "POST",
			body: JSON.stringify(data),
		}),

	verifyToken: () =>
		request<{ authenticated: boolean }>("/auth/verify", {
			method: "POST",
			body: JSON.stringify({}),
		}),

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
		tag?: string | string[];
		search?: string;
		sourceKind?: "all" | "conversation" | "memory";
		offset?: number;
		limit?: number;
	}) => {
		const query = new URLSearchParams();
		const tags = Array.isArray(params?.tag) ? params?.tag : params?.tag ? [params.tag] : [];
		for (const tag of tags) query.append("tag", tag);
		if (params?.search) query.set("search", params.search);
		if (params?.sourceKind && params.sourceKind !== "all") {
			query.set("sourceKind", params.sourceKind);
		}
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

	deleteNote: (id: number, body: DeleteNoteWebRequest) =>
		request<DeleteNoteReviewResponse>(`/notes/${id}`, {
			method: "DELETE",
			body: JSON.stringify(body),
		}),

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

	getGraphProjection: (params?: {
		level?: "tag" | "note";
		limit?: number;
		relationType?: string;
		project?: string;
		minConfidence?: number;
		minScore?: number;
	}) => {
		const query = new URLSearchParams();
		query.set("level", params?.level ?? "tag");
		if (params?.limit != null) query.set("limit", String(params.limit));
		if (params?.relationType) query.set("relationType", params.relationType);
		if (params?.project) query.set("project", params.project);
		if (params?.minConfidence != null) {
			query.set("minConfidence", String(params.minConfidence));
		}
		if (params?.minScore != null) query.set("minScore", String(params.minScore));
		return request<{
			nodes: {
				id: number;
				kind: "tag" | "note";
				title: string;
				name?: string;
				note_count?: number;
				project_count?: number;
				project_name?: string;
				tags?: string[];
				degree: number;
				source_type?: string | null;
				outcome_type?: string | null;
				task_kind?: string | null;
			}[];
			edges: {
				id: number | string;
				source: number;
				target: number;
				type: string;
				confidence?: number;
				score?: number;
				cooccurrence_count?: number;
				description?: string | null;
				created_by?: string;
			}[];
			stats: {
				totalNodes: number;
				totalEdges: number;
				visibleNodes: number;
				visibleEdges: number;
				limit: number;
				minConfidence?: number;
				minScore?: number;
			};
			truncated: boolean;
		}>(`/graph/projection?${query.toString()}`);
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
			cloudMode: boolean;
		}>("/config"),

	getProviders: async () => normalizeProviders(await request<ProviderResponse[]>("/providers")),

	discoverModels: (data: {
		target: "llm" | "embedding";
		provider: string;
		baseURL?: string;
		apiKey?: string;
	}) =>
		request<{
			models: { id: string; ownedBy: string | null }[];
		}>("/config/models", { method: "POST", body: JSON.stringify(data) }),

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
