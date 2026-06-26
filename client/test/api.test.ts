import assert from "node:assert/strict";
import test from "node:test";
import {
	api,
	isProviderModelDiscoverySupported,
	setStoredToken,
} from "../src/lib/api.ts";

test("web api sends stored tokens from remote HTTP origins", async () => {
	const storage = new Map<string, string>();
	const originalWindow = globalThis.window;
	const originalFetch = globalThis.fetch;
	let capturedHeaders: Headers | null = null;

	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			location: {
				protocol: "http:",
				hostname: "chatcrystal.example.com",
				origin: "http://chatcrystal.example.com",
			},
			localStorage: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => storage.set(key, value),
				removeItem: (key: string) => storage.delete(key),
			},
			dispatchEvent: () => true,
		},
	});

	globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
		capturedHeaders = new Headers(init?.headers);
		return new Response(JSON.stringify({ success: true, data: { authenticated: true } }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	try {
		setStoredToken("issue-10-token");
		await api.verifyToken();

		assert.equal(capturedHeaders?.get("authorization"), "Bearer issue-10-token");
	} finally {
		globalThis.fetch = originalFetch;
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: originalWindow,
		});
	}
});

test("web api posts model discovery requests and preserves error codes", async () => {
	const storage = new Map<string, string>();
	const originalWindow = globalThis.window;
	const originalFetch = globalThis.fetch;
	const captured: { path?: string; body?: unknown; headers?: Headers } = {};

	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			localStorage: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => storage.set(key, value),
				removeItem: (key: string) => storage.delete(key),
			},
			dispatchEvent: () => true,
		},
	});

	globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
		captured.path = String(input);
		captured.headers = new Headers(init?.headers);
		captured.body = JSON.parse(String(init?.body));
		return new Response(
			JSON.stringify({
				success: true,
				data: { models: [{ id: "gpt-4.1", ownedBy: "openai" }] },
			}),
			{
				status: 200,
				headers: { "Content-Type": "application/json" },
			},
		);
	};

	try {
		setStoredToken("model-token");
		const models = await api.discoverModels({
			target: "llm",
			provider: "openai",
			apiKey: "sk-test",
		});

		assert.equal(captured.path, "/api/config/models");
		assert.equal(captured.headers?.get("authorization"), "Bearer model-token");
		assert.deepEqual(captured.body, {
			target: "llm",
			provider: "openai",
			apiKey: "sk-test",
		});
		assert.deepEqual(models.models, [{ id: "gpt-4.1", ownedBy: "openai" }]);
	} finally {
		globalThis.fetch = originalFetch;
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: originalWindow,
		});
	}
});

test("web api normalizes missing provider model discovery support", async () => {
	const storage = new Map<string, string>();
	const originalWindow = globalThis.window;
	const originalFetch = globalThis.fetch;

	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			localStorage: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => storage.set(key, value),
				removeItem: (key: string) => storage.delete(key),
			},
			dispatchEvent: () => true,
		},
	});

	globalThis.fetch = async () =>
		new Response(
			JSON.stringify({
				success: true,
				data: [
					{
						name: "ollama",
						displayName: "Ollama",
						supportsEmbedding: true,
						requiresApiKey: false,
						requiresBaseURL: true,
					},
					{
						name: "openai",
						displayName: "OpenAI",
						supportsEmbedding: true,
						requiresApiKey: true,
						requiresBaseURL: false,
					},
					{
						name: "anthropic",
						displayName: "Anthropic",
						supportsEmbedding: false,
						requiresApiKey: true,
						requiresBaseURL: false,
					},
					{
						name: "google",
						displayName: "Google AI",
						supportsEmbedding: true,
						requiresApiKey: true,
						requiresBaseURL: false,
					},
					{
						name: "azure",
						displayName: "Azure OpenAI",
						supportsEmbedding: true,
						requiresApiKey: true,
						requiresBaseURL: true,
					},
					{
						name: "custom",
						displayName: "Custom",
						supportsEmbedding: true,
						requiresApiKey: true,
						requiresBaseURL: true,
					},
				],
			}),
			{
				status: 200,
				headers: { "Content-Type": "application/json" },
			},
		);

	try {
		const providers = await api.getProviders();
		const supportByProvider = Object.fromEntries(
			providers.map((provider) => [
				provider.name,
				provider.supportsModelDiscovery,
			]),
		);

		assert.deepEqual(supportByProvider, {
			ollama: true,
			openai: true,
			anthropic: true,
			google: true,
			azure: false,
			custom: true,
		});
	} finally {
		globalThis.fetch = originalFetch;
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: originalWindow,
		});
	}
});

test("provider model discovery support defaults stay aligned for cached provider data", () => {
	assert.equal(
		isProviderModelDiscoverySupported({ name: "ollama" }),
		true,
	);
	assert.equal(
		isProviderModelDiscoverySupported({ name: "openai" }),
		true,
	);
	assert.equal(
		isProviderModelDiscoverySupported({ name: "anthropic" }),
		true,
	);
	assert.equal(
		isProviderModelDiscoverySupported({ name: "google" }),
		true,
	);
	assert.equal(
		isProviderModelDiscoverySupported({ name: "custom" }),
		true,
	);
	assert.equal(
		isProviderModelDiscoverySupported({ name: "azure" }),
		false,
	);
	assert.equal(
		isProviderModelDiscoverySupported({
			name: "azure",
			supportsModelDiscovery: true,
		}),
		true,
	);
	assert.equal(
		isProviderModelDiscoverySupported({
			name: "openai",
			supportsModelDiscovery: false,
		}),
		false,
	);
});
