export type McpSnippetInput =
	| { mode: "local"; baseUrl: string }
	| { mode: "cloud"; baseUrl: string; token: string };

export type McpServerEntry = {
	command: "crystal";
	args: ["mcp"];
	env: Record<string, string>;
};

export type McpSnippet = {
	mcpServers: {
		chatcrystal: McpServerEntry;
	};
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isNonLocalHttpUrl(baseUrl: string): boolean {
	const url = new URL(baseUrl);
	return url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname);
}

export function buildMcpSnippet(input: McpSnippetInput): McpSnippet {
	const env: Record<string, string> = {
		CHATCRYSTAL_BASE_URL: input.baseUrl,
	};

	if (input.mode === "cloud") {
		env.CHATCRYSTAL_API_TOKEN = input.token;
		if (isNonLocalHttpUrl(input.baseUrl)) {
			env.CHATCRYSTAL_ALLOW_INSECURE_REMOTE_HTTP = "true";
		}
	}

	return {
		mcpServers: {
			chatcrystal: {
				command: "crystal",
				args: ["mcp"],
				env,
			},
		},
	};
}
