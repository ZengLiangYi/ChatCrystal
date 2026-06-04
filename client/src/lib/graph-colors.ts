export const GRAPH_RELATION_TYPES = [
	"CAUSED_BY",
	"LEADS_TO",
	"RESOLVED_BY",
	"SIMILAR_TO",
	"CONTRADICTS",
	"DEPENDS_ON",
	"EXTENDS",
	"REFERENCES",
] as const;

const GRAPH_EDGE_VARS: Record<(typeof GRAPH_RELATION_TYPES)[number], string> = {
	CAUSED_BY: "--graph-edge-caused-by",
	LEADS_TO: "--graph-edge-leads-to",
	RESOLVED_BY: "--graph-edge-resolved-by",
	SIMILAR_TO: "--graph-edge-similar-to",
	CONTRADICTS: "--graph-edge-contradicts",
	DEPENDS_ON: "--graph-edge-depends-on",
	EXTENDS: "--graph-edge-extends",
	REFERENCES: "--graph-edge-references",
};

const GRAPH_PROJECT_VARS = [
	"--graph-project-1",
	"--graph-project-2",
	"--graph-project-3",
	"--graph-project-4",
	"--graph-project-5",
	"--graph-project-6",
	"--graph-project-7",
	"--graph-project-8",
	"--graph-project-9",
	"--graph-project-10",
] as const;

function readThemeColor(variableName: string, fallback: string) {
	if (typeof document === "undefined") return fallback;

	const value = getComputedStyle(document.documentElement)
		.getPropertyValue(variableName)
		.trim();
	return value || fallback;
}

export function getGraphEdgeColor(type: string) {
	const variableName =
		GRAPH_EDGE_VARS[type as (typeof GRAPH_RELATION_TYPES)[number]] ??
		"--graph-edge-references";
	return readThemeColor(variableName, readThemeColor("--text-muted", "rgb(139, 141, 135)"));
}

export function getGraphProjectColor(index: number) {
	const variableName = GRAPH_PROJECT_VARS[index % GRAPH_PROJECT_VARS.length];
	return readThemeColor(variableName, readThemeColor("--accent", "rgb(231, 182, 95)"));
}

export function getGraphCanvasColors() {
	return {
		background: readThemeColor("--bg-primary", "rgb(16, 17, 19)"),
		foreground: readThemeColor("--text-primary", "rgb(242, 240, 234)"),
		muted: readThemeColor("--text-muted", "rgb(111, 113, 110)"),
		border: readThemeColor("--border", "rgb(42, 45, 49)"),
		accent: readThemeColor("--accent", "rgb(231, 182, 95)"),
	};
}

export function withAlpha(color: string, alpha: number) {
	const normalizedAlpha = Math.max(0, Math.min(1, alpha));
	const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
	if (hex) {
		const full =
			hex.length === 3
				? hex
						.split("")
						.map((part) => part + part)
						.join("")
				: hex;
		const value = Number.parseInt(full, 16);
		const red = (value >> 16) & 255;
		const green = (value >> 8) & 255;
		const blue = value & 255;
		return `rgba(${red}, ${green}, ${blue}, ${normalizedAlpha})`;
	}

	const rgb = color
		.trim()
		.match(/^rgba?\(\s*([.\d]+)[,\s]+([.\d]+)[,\s]+([.\d]+)/i);
	if (rgb) {
		const [, red, green, blue] = rgb;
		return `rgba(${red}, ${green}, ${blue}, ${normalizedAlpha})`;
	}

	return color;
}
