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

export function buildMcpSnippet(input: McpSnippetInput): McpSnippet {
	const env: Record<string, string> = {
		CHATCRYSTAL_BASE_URL: input.baseUrl,
	};

	if (input.mode === "cloud") {
		env.CHATCRYSTAL_API_TOKEN = input.token;
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
