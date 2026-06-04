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
} as const;

export function getSourceColor(source: string) {
	return SOURCE_CONFIG[source as keyof typeof SOURCE_CONFIG]?.color ?? "var(--text-muted)";
}

export function getSourceLabel(source: string) {
	return SOURCE_CONFIG[source as keyof typeof SOURCE_CONFIG]?.label ?? source;
}
