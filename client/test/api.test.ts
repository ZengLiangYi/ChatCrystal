import assert from "node:assert/strict";
import test from "node:test";
import { api, setStoredToken } from "../src/lib/api.ts";

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
