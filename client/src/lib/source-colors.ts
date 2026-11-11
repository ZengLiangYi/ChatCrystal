export const SOURCE_CONFIG = {
	"claude-code": {
		label: "Claude",
		color: "var(--source-claude-code)",
	},
	codex: {
		label: "Codex",
		color: "var(--source-codex)",
	},
	cursor: {
		label: "Cursor",
		color: "var(--source-cursor)",
	},
	trae: {
		label: "Trae",
		color: "var(--source-trae)",
	},
	copilot: {
		label: "Copilot",
		color: "var(--source-copilot)",
	},
	gemini: {
		label: "Gemini",
		color: "var(--source-gemini)",
	},
	qwen: {
		label: "Qwen",
		color: "var(--source-qwen)",
	},
	opencode: {
		label: "OpenCode",
		color: "var(--source-opencode)",
	},
	cline: {
		label: "Cline",
		color: "var(--source-cline)",
	},
	roo: {
		label: "Roo",
		color: "var(--source-roo)",
	},
	kilo: {
		label: "Kilo",
		color: "var(--source-kilo)",
	},
	"copilot-cli": {
		label: "Copilot CLI",
		color: "var(--source-copilot-cli)",
	},
	continue: {
		label: "Continue",
		color: "var(--source-continue)",
	},
	dsh: {
		label: "DeepSeek",
		color: "var(--source-dsh)",
	},
	workbuddy: {
		label: "WorkBuddy",
		color: "var(--source-workbuddy)",
	},
	antigravity: {
		label: "Antigravity",
		color: "var(--source-antigravity)",
	},
	droid: {
		label: "Droid",
		color: "var(--source-droid)",
	},
	goose: {
		label: "Goose",
		color: "var(--source-goose)",
	},
	pi: {
		label: "Pi",
		color: "var(--source-pi)",
	},
	omp: {
		label: "omp",
		color: "var(--source-omp)",
	},
	raft: {
		label: "Raft",
		color: "var(--source-raft)",
	},
	cindy: {
		label: "Cindy",
		color: "var(--source-cindy)",
	},
	qoder: {
		label: "Qoder",
		color: "var(--source-qoder)",
	},
	"qoder-cn": {
		label: "Qoder CN",
		color: "var(--source-qoder-cn)",
	},
	codebuddy: {
		label: "CodeBuddy",
		color: "var(--source-codebuddy)",
	},
	"claude-desktop": {
		label: "Claude Desktop",
		color: "var(--source-claude-desktop)",
	},
	zcode: {
		label: "ZCode",
		color: "var(--source-zcode)",
	},
	hermes: {
		label: "Hermes",
		color: "var(--source-hermes)",
	},
	alma: {
		label: "Alma",
		color: "var(--source-alma)",
	},
	grok: {
		label: "Grok",
		color: "var(--source-grok)",
	},
	kimi: {
		label: "Kimi",
		color: "var(--source-kimi)",
	},
	"minimax-code": {
		label: "MiniMax",
		color: "var(--source-minimax-code)",
	},
} as const;

export function getSourceColor(source: string) {
	return SOURCE_CONFIG[source as keyof typeof SOURCE_CONFIG]?.color ?? "var(--text-muted)";
}

export function getSourceLabel(source: string) {
	return SOURCE_CONFIG[source as keyof typeof SOURCE_CONFIG]?.label ?? source;
}
