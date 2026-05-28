import assert from "node:assert/strict";
import test from "node:test";
import { buildMcpSnippet } from "../mcp-snippets.js";

test("local MCP snippet points crystal mcp at the active local core", () => {
	assert.deepEqual(buildMcpSnippet({ mode: "local", baseUrl: "http://localhost:3721" }), {
		mcpServers: {
			chatcrystal: {
				command: "crystal",
				args: ["mcp"],
				env: {
					CHATCRYSTAL_BASE_URL: "http://localhost:3721",
				},
			},
		},
	});
});

test("cloud MCP snippet includes base URL and API token", () => {
	assert.deepEqual(buildMcpSnippet({
		mode: "cloud",
		baseUrl: "https://crystal.example.com",
		token: "plain-token",
	}), {
		mcpServers: {
			chatcrystal: {
				command: "crystal",
				args: ["mcp"],
				env: {
					CHATCRYSTAL_BASE_URL: "https://crystal.example.com",
					CHATCRYSTAL_API_TOKEN: "plain-token",
				},
			},
		},
	});
});

test("non-local HTTP cloud MCP snippet only includes connection details", () => {
	const snippet = buildMcpSnippet({
		mode: "cloud",
		baseUrl: "http://crystal.example.com",
		token: "plain-token",
	});

	assert.deepEqual(snippet.mcpServers.chatcrystal.env, {
		CHATCRYSTAL_BASE_URL: "http://crystal.example.com",
		CHATCRYSTAL_API_TOKEN: "plain-token",
	});
});
