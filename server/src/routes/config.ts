import { generateText } from "ai";
import type { FastifyInstance } from "fastify";
import { appConfig, updateConfig } from "../config.js";
import { getDatabase, saveDatabase } from "../db/index.js";
import { taskTracker } from "../queue/index.js";
import { getLanguageModel } from "../services/llm.js";
import { listProviders } from "../services/providers.js";

export async function configRoutes(app: FastifyInstance) {
	// List available providers
	app.get("/api/providers", async () => {
		const providers = listProviders().map((p) => ({
			name: p.name,
			displayName: p.displayName,
			supportsEmbedding: p.supportsEmbedding,
			requiresApiKey: p.requiresApiKey,
			requiresBaseURL: p.requiresBaseURL,
		}));
		return { success: true, data: providers };
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
				db.run("DELETE FROM embeddings");
				saveDatabase();
				// Clear vectra index
				const { resolve } = await import("node:path");
				const { rmSync, existsSync } = await import("node:fs");
				const indexPath = resolve(appConfig.dataDir, "vectra-index");
				if (existsSync(indexPath)) {
					rmSync(indexPath, { recursive: true, force: true });
				}
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

	// Test connection
	app.post("/api/config/test", async (_req, reply) => {
		try {
			const model = getLanguageModel();
			const result = await generateText({
				model,
				prompt: "Reply with exactly: OK",
				maxOutputTokens: 5,
			});
			return {
				success: true,
				data: { connected: true, response: result.text.trim() },
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : "Connection failed";
			reply.status(200); // Don't 500 for connection test
			return {
				success: true,
				data: { connected: false, error: message },
			};
		}
	});
}
