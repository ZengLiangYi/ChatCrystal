import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, resolve } from "node:path";
import type { ChatCrystalSource } from "@chatcrystal/shared";
import { runtimePaths } from "./runtime/paths.js";

function resolveHome(p: string): string {
	if (p.startsWith("~")) {
		return resolve(homedir(), p.slice(2));
	}
	return resolve(p);
}

function envDir(name: string, fallback: string): string {
	return resolveHome(process.env[name] || fallback);
}

/** VS Code's per-user data folder ("User"), used by VS Code chat-session agents. */
function getVsCodeUserDir(): string {
	if (process.env.VSCODE_USER_DIR) return resolveHome(process.env.VSCODE_USER_DIR);
	if (platform() === "win32") {
		return resolve(process.env.APPDATA || homedir(), "Code", "User");
	}
	if (platform() === "darwin") {
		return resolve(homedir(), "Library", "Application Support", "Code", "User");
	}
	return resolve(homedir(), ".config", "Code", "User");
}

function getOpencodeDataDir(): string {
	if (process.env.OPENCODE_DATA_DIR) return resolveHome(process.env.OPENCODE_DATA_DIR);
	const xdg = process.env.XDG_DATA_HOME;
	if (xdg) return resolve(xdg, "opencode");
	// OpenCode keeps ~/.local/share/opencode on Windows too.
	return resolve(homedir(), ".local", "share", "opencode");
}

function getGooseDataDir(): string {
	if (process.env.GOOSE_DATA_DIR) return resolveHome(process.env.GOOSE_DATA_DIR);
	if (platform() === "win32") {
		return resolve(process.env.APPDATA || homedir(), "Block", "goose", "data");
	}
	if (platform() === "darwin") {
		return resolve(homedir(), "Library", "Application Support", "Block", "goose", "data");
	}
	return resolve(homedir(), ".local", "share", "goose");
}

/** Platform per-user config folder (Electron's userData parent). */
function getUserConfigDir(): string {
	if (platform() === "win32") {
		return process.env.APPDATA || resolve(homedir(), "AppData", "Roaming");
	}
	if (platform() === "darwin") {
		return resolve(homedir(), "Library", "Application Support");
	}
	return process.env.XDG_CONFIG_HOME
		? resolveHome(process.env.XDG_CONFIG_HOME)
		: resolve(homedir(), ".config");
}

const userConfigDir = getUserConfigDir();

const vscodeUserDir = getVsCodeUserDir();

/**
 * Every conversation source ChatCrystal can import, in display order.
 * Must stay in sync with the adapters registered in `parser/index.ts`.
 */
export const ALL_SOURCE_NAMES: ChatCrystalSource[] = [
	// Original five
	"claude-code",
	"codex",
	"cursor",
	"trae",
	"copilot",
	// 2026 expansion: multi-agent coverage
	"gemini",
	"qwen",
	"opencode",
	"cline",
	"roo",
	"kilo",
	"copilot-cli",
	"continue",
	"dsh",
	"workbuddy",
	"antigravity",
	"droid",
	"goose",
	// 2026 expansion, second wave: the rest of magpie's session readers
	"pi",
	"omp",
	"raft",
	"cindy",
	"qoder",
	"qoder-cn",
	"codebuddy",
	"claude-desktop",
	"zcode",
	"hermes",
	"alma",
	"grok",
	"kimi",
	"minimax-code",
];

// Defaults from .env
const envDefaults = {
	port: Number(process.env.PORT) || 3721,
	dataDir: runtimePaths.dataDir,
	claudeProjectsDir: envDir("CLAUDE_PROJECTS_DIR", "~/.claude/projects"),
	codexSessionsDir: envDir("CODEX_SESSIONS_DIR", "~/.codex/sessions"),
	cursorDataDir: process.env.CURSOR_DATA_DIR || "",
	traeDataDir: process.env.TRAE_DATA_DIR || "",
	copilotDataDir: process.env.COPILOT_DATA_DIR || "",
	// --- 2026 agent-harness expansion ---
	geminiDataDir: envDir("GEMINI_DATA_DIR", "~/.gemini"),
	qwenDataDir: envDir("QWEN_DATA_DIR", "~/.qwen"),
	opencodeDataDir: getOpencodeDataDir(),
	clineDataDir: envDir("CLINE_DATA_DIR", "~/.cline"),
	// Cline / Roo Code / Kilo Code VS Code extensions store task history in
	// <VS Code User>/globalStorage/<extension-id>.
	clineExtDataDir: envDir(
		"CLINE_EXT_DATA_DIR",
		resolve(vscodeUserDir, "globalStorage", "saoudrizwan.claude-dev"),
	),
	rooDataDir: envDir(
		"ROO_DATA_DIR",
		resolve(vscodeUserDir, "globalStorage", "rooveterinaryinc.roo-cline"),
	),
	kiloDataDir: envDir(
		"KILO_DATA_DIR",
		resolve(vscodeUserDir, "globalStorage", "kilocode.kilo-code"),
	),
	copilotCliDataDir: envDir("COPILOT_CLI_DATA_DIR", "~/.copilot"),
	continueDataDir: envDir("CONTINUE_DATA_DIR", "~/.continue"),
	dshSessionsDir: envDir("DSH_SESSIONS_DIR", "~/.dsh/sessions"),
	workbuddyDataDir: envDir("WORKBUDDY_DATA_DIR", "~/.workbuddy"),
	workbuddyAiDataDir: envDir("WORKBUDDY_AI_DATA_DIR", "~/.workbuddy-ai"),
	antigravityDataDir: envDir("ANTIGRAVITY_DATA_DIR", "~/.gemini/antigravity"),
	droidDataDir: envDir("DROID_DATA_DIR", "~/.factory"),
	gooseDataDir: getGooseDataDir(),
	// --- 2026 expansion, second wave ---
	piDataDir: envDir("PI_CODING_AGENT_DIR", "~/.pi/agent"),
	ompDataDir: envDir("OMP_DATA_DIR", "~/.omp/agent"),
	raftDataDir: envDir("SLOCK_HOME", "~/.slock"),
	cindyDataDir: envDir("CINDY_CONFIG_DIR", userConfigDir),
	qoderDataDir: envDir("QODER_CONFIG_DIR", "~/.qoder"),
	qoderCnDataDir: envDir("QODERCN_CONFIG_DIR", "~/.qoder-cn"),
	codebuddyDataDir: envDir("CODEBUDDY_CONFIG_DIR", "~/.codebuddy"),
	claudeDesktopDataDir: envDir(
		"CLAUDE_DESKTOP_DATA_DIR",
		resolve(userConfigDir, "Claude"),
	),
	zcodeDataDir: envDir("ZCODE_HOME", "~/.zcode"),
	hermesDataDir: envDir("HERMES_HOME", "~/.hermes"),
	almaDataDir: envDir("ALMA_DATA_DIR", resolve(userConfigDir, "alma")),
	grokDataDir: envDir("GROK_HOME", "~/.grok"),
	kimiDataDir: envDir("KIMI_CODE_HOME", "~/.kimi-code"),
	minimaxDataDir: envDir("MINIMAX_DATA_DIR", "~/.minimax"),
	llm: {
		provider: process.env.LLM_PROVIDER || "ollama",
		baseURL: process.env.LLM_BASE_URL || "http://localhost:11434",
		apiKey: process.env.LLM_API_KEY || "",
		model: process.env.LLM_MODEL || "qwen2.5:7b",
		maxInputChars: Number(process.env.LLM_MAX_INPUT_CHARS) || 32000,
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
	const configPath = runtimePaths.configPath;
	const defaults = {
		...envDefaults,
		enabledSources: [...ALL_SOURCE_NAMES] as string[],
	};
	if (!existsSync(configPath)) return defaults;

	try {
		const saved = JSON.parse(readFileSync(configPath, "utf-8"));

		// Migrate: ensure newly added sources are present in existing configs
		const enabledSources: string[] = Array.isArray(saved.enabledSources)
			? saved.enabledSources
			: [...ALL_SOURCE_NAMES];
		for (const src of ALL_SOURCE_NAMES) {
			if (!enabledSources.includes(src)) {
				enabledSources.push(src);
			}
		}

		return {
			...envDefaults,
			llm: { ...envDefaults.llm, ...saved.llm },
			embedding: { ...envDefaults.embedding, ...saved.embedding },
			enabledSources,
		};
	} catch (err) {
		console.warn(
			"[Config] Failed to load config.json, using .env defaults:",
			err instanceof Error ? err.message : err,
		);
		return defaults;
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
	const configPath = runtimePaths.configPath;
	const toSave = {
		llm: { ...appConfig.llm },
		embedding: { ...appConfig.embedding },
		enabledSources: appConfig.enabledSources,
	};
	// Don't persist empty apiKeys (keep in .env only)
	if (!toSave.llm.apiKey) delete (toSave.llm as Record<string, unknown>).apiKey;
	if (!toSave.embedding.apiKey)
		delete (toSave.embedding as Record<string, unknown>).apiKey;

	mkdirSync(dirname(configPath), { recursive: true });
	writeFileSync(configPath, JSON.stringify(toSave, null, 2), {
		encoding: "utf-8",
		mode: 0o600,
	});
	chmodSync(configPath, 0o600);
}
