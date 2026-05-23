import assert from "node:assert/strict";
import test from "node:test";
import { buildMcpSnippet, isNonLocalHttpUrl } from "../mcp-snippets.js";

test("local MCP snippet points crystal mcp at the active local core", () => {
	assert.deepEqual(buildMcpSnippet({ mode: "local", baseUrl: "http://localhost:3721" }), {
		command: "crystal",
		args: ["mcp"],
		env: {
			CHATCRYSTAL_BASE_URL: "http://localhost:3721",
		},
	});
});

test("cloud MCP snippet includes base URL and API token", () => {
	assert.deepEqual(buildMcpSnippet({
		mode: "cloud",
		baseUrl: "https://crystal.example.com",
		token: "plain-token",
	}), {
		command: "crystal",
		args: ["mcp"],
		env: {
			CHATCRYSTAL_BASE_URL: "https://crystal.example.com",
			CHATCRYSTAL_API_TOKEN: "plain-token",
		},
	});
});

test("non-local HTTP cloud MCP snippet includes explicit insecure transport allowance", () => {
	const snippet = buildMcpSnippet({
		mode: "cloud",
		baseUrl: "http://crystal.example.com",
		token: "plain-token",
	});

	assert.equal(isNonLocalHttpUrl("http://crystal.example.com"), true);
	assert.deepEqual(snippet.env, {
		CHATCRYSTAL_BASE_URL: "http://crystal.example.com",
		CHATCRYSTAL_API_TOKEN: "plain-token",
		CHATCRYSTAL_ALLOW_INSECURE_REMOTE_HTTP: "true",
	});
});

test("localhost HTTP is not treated as non-local insecure MCP transport", () => {
	assert.equal(isNonLocalHttpUrl("http://localhost:3721"), false);
	assert.equal(isNonLocalHttpUrl("http://127.0.0.1:3721"), false);
});
