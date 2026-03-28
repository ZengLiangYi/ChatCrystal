import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { config } from "dotenv";

// Conditionally load .env (not available inside packaged Electron ASAR)
const envCandidates = [
	resolve(import.meta.dirname, "../../.env"),
	resolve(import.meta.dirname, "../../../../.env"),
];
for (const envPath of envCandidates) {
	if (existsSync(envPath)) {
		config({ path: envPath });
		break;
	}
}

function resolveHome(p: string): string {
	if (p.startsWith("~")) {
		return resolve(homedir(), p.slice(2));
	}
	return resolve(p);
}

// Defaults from .env
const envDefaults = {
	port: Number(process.env.PORT) || 3721,
	dataDir: isAbsolute(process.env.DATA_DIR || "")
		? process.env.DATA_DIR!
		: (() => {
				// Try source layout first, then compiled layout
				const rel = process.env.DATA_DIR || "./data";
				const candidate = resolve(import.meta.dirname, "../../", rel);
				const candidate2 = resolve(import.meta.dirname, "../../../../", rel);
				// Pick the one where the parent directory exists
				return existsSync(resolve(candidate, "..")) ? candidate : candidate2;
			})(),
	claudeProjectsDir: resolveHome(
		process.env.CLAUDE_PROJECTS_DIR || "~/.claude/projects",
	),
	codexSessionsDir: resolveHome(
		process.env.CODEX_SESSIONS_DIR || "~/.codex/sessions",
	),
	cursorDataDir: process.env.CURSOR_DATA_DIR || "",
	llm: {
		provider: process.env.LLM_PROVIDER || "ollama",
		baseURL: process.env.LLM_BASE_URL || "http://localhost:11434",
		apiKey: process.env.LLM_API_KEY || "",
		model: process.env.LLM_MODEL || "qwen2.5:7b",
	},
	embedding: {
		provider: process.env.EMBEDDING_PROVIDER || "ollama",
		baseURL: process.env.EMBEDDING_BASE_URL || "http://localhost:11434",
		apiKey: process.env.EMBEDDING_API_KEY || "",
		model: process.env.EMBEDDING_MODEL || "nomic-embed-text",
	},
};

// Load persisted config.json if exists, overlay on env defaults
function loadPersistedConfig() {
	const configPath = resolve(envDefaults.dataDir, "config.json");
	if (!existsSync(configPath))
		return {
			...envDefaults,
			enabledSources: ["claude-code", "codex", "cursor"],
		};

	try {
		const saved = JSON.parse(readFileSync(configPath, "utf-8"));
		return {
			...envDefaults,
			llm: { ...envDefaults.llm, ...saved.llm },
			embedding: { ...envDefaults.embedding, ...saved.embedding },
			enabledSources: saved.enabledSources ?? [
				"claude-code",
				"codex",
				"cursor",
			],
		};
	} catch (err) {
		console.warn(
			"[Config] Failed to load config.json, using .env defaults:",
			err instanceof Error ? err.message : err,
		);
		return {
			...envDefaults,
			enabledSources: ["claude-code", "codex", "cursor"],
		};
	}
}

export const appConfig = loadPersistedConfig();

/**
 * Update config in memory and persist to data/config.json.
 */
export function updateConfig(partial: {
	llm?: Partial<typeof appConfig.llm>;
	embedding?: Partial<typeof appConfig.embedding>;
	enabledSources?: string[];
}) {
	if (partial.llm) {
		Object.assign(appConfig.llm, partial.llm);
	}
	if (partial.embedding) {
		Object.assign(appConfig.embedding, partial.embedding);
	}
	if (partial.enabledSources) {
		appConfig.enabledSources = partial.enabledSources;
	}
	persistConfig();
}

function persistConfig() {
	const configPath = resolve(appConfig.dataDir, "config.json");
	const toSave = {
		llm: { ...appConfig.llm },
		embedding: { ...appConfig.embedding },
		enabledSources: appConfig.enabledSources,
	};
	// Don't persist empty apiKeys (keep in .env only)
	if (!toSave.llm.apiKey) delete (toSave.llm as Record<string, unknown>).apiKey;
	if (!toSave.embedding.apiKey)
		delete (toSave.embedding as Record<string, unknown>).apiKey;

	writeFileSync(configPath, JSON.stringify(toSave, null, 2), "utf-8");
}
