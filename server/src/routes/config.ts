import { generateText, embed } from "ai";
import type { FastifyInstance } from "fastify";
import { appConfig, updateConfig } from "../config.js";
import { getDatabase, saveDatabase } from "../db/index.js";
import { withTransaction } from "../db/transaction.js";
import { taskTracker } from "../queue/index.js";
import { clearEmbeddingIndex } from "../services/embedding.js";
import { getLanguageModel } from "../services/llm.js";
import {
	ModelDiscoveryError,
	discoverProviderModels,
} from "../services/modelDiscovery.js";
import { getProvider, listProviders } from "../services/providers.js";
import { isCloudMode } from "../runtime/cloud.js";
import { isLocalBrowserRequestOriginAllowed } from "../runtime/localOrigin.js";

// OpenAI Responses-compatible gateways such as NewAPI reject lower values.
const CONFIG_TEST_MAX_OUTPUT_TOKENS = 16;

export async function configRoutes(app: FastifyInstance) {
	// List available providers
	app.get("/api/providers", async () => {
		const providers = listProviders().map((p) => ({
			name: p.name,
			displayName: p.displayName,
			supportsEmbedding: p.supportsEmbedding,
			supportsModelDiscovery: p.supportsModelDiscovery,
			requiresApiKey: p.requiresApiKey,
			requiresBaseURL: p.requiresBaseURL,
		}));
		return { success: true, data: providers };
	});

	app.post("/api/config/models", async (req, reply) => {
		if (isCloudMode()) {
			reply.status(403);
			return {
				success: false,
				code: "cloud_unsupported",
				error: "云端模式暂不支持获取模型列表",
			};
		}
		if (!isLocalBrowserRequestOriginAllowed(req.headers.origin, req.headers.referer)) {
			reply.status(403);
			return {
				success: false,
				code: "local_origin_required",
				error: "Model discovery must be started from ChatCrystal.",
			};
		}

		const body = req.body as {
			target?: "llm" | "embedding";
			provider?: string;
			baseURL?: string;
			apiKey?: string;
		};
		const target = body.target;

		if (target !== "llm" && target !== "embedding") {
			reply.status(400);
			return {
				success: false,
				code: "invalid_target",
				error: "Invalid model discovery target",
			};
		}

		const savedConfig = appConfig[target];
		const apiKey = body.apiKey?.trim() ? body.apiKey : savedConfig.apiKey;

		try {
			const models = await discoverProviderModels({
				target,
				provider: body.provider || savedConfig.provider,
				baseURL: body.baseURL ?? savedConfig.baseURL,
				apiKey,
			});
			return { success: true, data: { models } };
		} catch (error) {
			if (error instanceof ModelDiscoveryError) {
				reply.status(modelDiscoveryStatusCode(error.code));
				return {
					success: false,
					code: error.code,
					error: error.message,
				};
			}

			reply.status(500);
			return {
				success: false,
				code: "request_failed",
				error:
					error instanceof Error
						? error.message
						: "Model discovery request failed",
			};
		}
	});

	// Update config with protection
	app.post("/api/config", async (req) => {
		const body = req.body as {
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
		};

		const warnings: string[] = [];

		// Check embedding model change
		if (body.embedding) {
			const newProvider =
				body.embedding.provider || appConfig.embedding.provider;
			const newModel = body.embedding.model || appConfig.embedding.model;
			const changed =
				newProvider !== appConfig.embedding.provider ||
				newModel !== appConfig.embedding.model;

			if (changed) {
				const db = getDatabase();
				const countResult = db.exec("SELECT COUNT(*) FROM embeddings");
				const embeddingCount = Number(countResult[0]?.values[0]?.[0] ?? 0);

				if (embeddingCount > 0) {
					warnings.push(
						`切换 Embedding 模型将清空现有 ${embeddingCount} 条向量索引，需要重新生成`,
					);
				}
			}
		}

		// Check queue activity
		if (taskTracker.hasActiveTasks()) {
			const snapshot = taskTracker.getSnapshot();
			warnings.push(
				`当前有 ${snapshot.active} 个任务进行中，切换后新任务将使用新 provider`,
			);
		}

		// If warnings and not confirmed, ask for confirmation
		if (warnings.length > 0 && !body.confirm) {
			return {
				success: true,
				data: { requiresConfirm: true, warnings },
			};
		}

		// If embedding model changed and confirmed, clear embeddings
		if (body.embedding && body.confirm) {
			const newProvider =
				body.embedding.provider || appConfig.embedding.provider;
			const newModel = body.embedding.model || appConfig.embedding.model;
			const changed =
				newProvider !== appConfig.embedding.provider ||
				newModel !== appConfig.embedding.model;

			if (changed) {
				const db = getDatabase();
				withTransaction(db, () => {
					db.run("DELETE FROM embeddings");
					db.run("UPDATE notes SET embedding_status = 'pending'");
				});
				saveDatabase();
				clearEmbeddingIndex();
				console.log(
					"[Config] Cleared embeddings and vectra index due to model change",
				);
			}
		}

		// Apply config
		updateConfig({
			llm: body.llm,
			embedding: body.embedding,
			enabledSources: body.enabledSources,
		});

		console.log(
			`[Config] Updated — LLM: ${appConfig.llm.provider}/${appConfig.llm.model}, Embedding: ${appConfig.embedding.provider}/${appConfig.embedding.model}`,
		);

		return {
			success: true,
			data: {
				llm: {
					provider: appConfig.llm.provider,
					baseURL: appConfig.llm.baseURL,
					model: appConfig.llm.model,
					hasApiKey: !!appConfig.llm.apiKey,
				},
				embedding: {
					provider: appConfig.embedding.provider,
					baseURL: appConfig.embedding.baseURL,
					model: appConfig.embedding.model,
					hasApiKey: !!appConfig.embedding.apiKey,
				},
			},
		};
	});

	// Test connection (LLM + Embedding)
	app.post("/api/config/test", async (_req, reply) => {
		const result: {
			llm: { connected: boolean; response?: string; error?: string };
			embedding: { connected: boolean; error?: string };
		} = {
			llm: { connected: false },
			embedding: { connected: false },
		};

		// Test LLM
		try {
			const model = getLanguageModel();
			const llmResult = await generateText({
				model,
				prompt: "Reply with exactly: OK",
				maxOutputTokens: CONFIG_TEST_MAX_OUTPUT_TOKENS,
			});
			result.llm = { connected: true, response: llmResult.text.trim() };
		} catch (err) {
			result.llm = {
				connected: false,
				error: err instanceof Error ? err.message : "LLM connection failed",
			};
		}

		// Test Embedding
		try {
			const entry = getProvider(appConfig.embedding.provider);
			if (!entry.createEmbeddingModel) {
				result.embedding = {
					connected: false,
					error: `Provider "${appConfig.embedding.provider}" does not support embeddings`,
				};
			} else {
				const embeddingModel = entry.createEmbeddingModel(appConfig.embedding);
				await embed({ model: embeddingModel, value: "test" });
				result.embedding = { connected: true };
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Embedding connection failed";
			// Detect common misconfig: using LLM model as embedding model
			const hint = msg.includes("Not Found") || msg.includes("404")
				? ". This model may not support embeddings — use a dedicated embedding model (e.g. nomic-embed-text, text-embedding-3-small)"
				: "";
			result.embedding = { connected: false, error: msg + hint };
		}

		// Backward compat: top-level connected = both connected
		reply.status(200);
		return {
			success: true,
			data: {
				connected: result.llm.connected && result.embedding.connected,
				response: result.llm.response,
				error: !result.llm.connected ? result.llm.error : !result.embedding.connected ? result.embedding.error : undefined,
				llm: result.llm,
				embedding: result.embedding,
			},
		};
	});
}

function modelDiscoveryStatusCode(code: string): number {
	switch (code) {
		case "missing_api_key":
		case "missing_base_url":
		case "provider_unsupported":
			return 400;
		case "auth_failed":
			return 400;
		case "endpoint_not_found":
			return 404;
		case "timeout":
		case "parse_failed":
		case "request_failed":
			return 502;
		default:
			return 500;
	}
}
