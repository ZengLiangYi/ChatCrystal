import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

function readSource(relativePath: string) {
	return readFileSync(path.join(root, relativePath), "utf-8");
}

function readFunctionBlock(source: string, startPattern: string, endPattern: string) {
	const start = source.indexOf(startPattern);
	const end = source.indexOf(endPattern, start);
	assert.notEqual(start, -1, `Missing source block start: ${startPattern}`);
	assert.notEqual(end, -1, `Missing source block end: ${endPattern}`);
	return source.slice(start, end);
}

test("NoteDetail gates original conversation navigation on API availability", () => {
	const source = readSource("src/pages/NoteDetail.tsx");

	assert.match(source, /can_open_original_conversation/);
	assert.match(source, /\{canOpenOriginalConversation && \(/);
});

test("NoteDetail exports markdown through the shared shadcn Button", () => {
	const source = readSource("src/pages/NoteDetail.tsx");
	const appSource = readSource("src/App.tsx");

	assert.match(source, /@\/components\/ui\/button/);
	assert.match(source, /@\/lib\/markdown-export/);
	assert.match(source, /@\/lib\/notify/);
	assert.match(source, /Download/);
	assert.match(source, /note_detail\.export_markdown/);
	assert.match(source, /note_detail\.markdown_section\.summary/);
	assert.match(source, /note_detail\.markdown_section\.key_conclusions/);
	assert.match(source, /note_detail\.markdown_section\.code_snippets/);
	assert.match(source, /<Button/);
	assert.match(source, /variant="outline"/);
	assert.match(source, /data-icon="inline-start"/);
	assert.match(source, /notify\.error/);
	assert.match(appSource, /@\/components\/ui\/sonner/);
	assert.match(appSource, /<Toaster/);
	assert.doesNotMatch(source, /<button\b/);
	assert.doesNotMatch(source, /window\.alert/);
});

test("Notes page treats task memory as a tag-like filter and hides it by default", () => {
	const source = readSource("src/pages/Notes.tsx");

	assert.match(source, /sourceKind/);
	assert.match(source, /sourceKind: includeTaskMemory \? 'memory' : 'conversation'/);
	assert.match(source, /includeTaskMemory/);
	assert.match(source, /selectedTags/);
	assert.match(source, /notes\.filter\.task_memory/);
	assert.doesNotMatch(source, /SOURCE_FILTERS/);
});

test("Notes page uses shadcn primitives for the dense filter toolbar", () => {
	const source = readSource("src/pages/Notes.tsx");

	assert.match(source, /@\/components\/ui\/button/);
	assert.match(source, /@\/components\/ui\/input/);
	assert.match(source, /@\/components\/ui\/badge/);
	assert.match(source, /@\/components\/ui\/popover/);
	assert.match(source, /@\/components\/ui\/command/);
	assert.match(source, /<Popover/);
	assert.match(source, /<Command/);
	assert.match(source, /<Input/);
	assert.match(source, /<Badge/);
	assert.match(source, /tag: selectedTags\.length > 0 \? selectedTags : undefined/);
});

test("Notes page keeps clear filters inside the tag search control", () => {
	const source = readSource("src/pages/Notes.tsx");

	assert.match(source, /className="flex min-w-\[220px\] xl:w-80"/);
	assert.match(source, /disabled=\{!hasActiveFilters\}/);
	assert.match(source, /aria-label=\{t\('notes\.filter\.clear'\)\}/);
	assert.match(source, /title=\{t\('notes\.filter\.clear'\)\}/);
	assert.doesNotMatch(source, /\{hasActiveFilters && \(/);
});

test("Search page uses shadcn search controls", () => {
	const source = readSource("src/pages/SearchPage.tsx");

	assert.match(source, /@\/components\/ui\/button/);
	assert.match(source, /@\/components\/ui\/input/);
	assert.match(source, /@\/components\/ui\/checkbox/);
	assert.match(source, /<Input/);
	assert.match(source, /<Button/);
	assert.match(source, /<Checkbox/);
});

test("Search page labels semantic scores as relevance", () => {
	const source = readSource("src/pages/SearchPage.tsx");

	assert.match(source, /search_page\.relevance_score/);
	assert.doesNotMatch(source, /\(result\.score \* 100\)\.toFixed\(0\)\}%/);
});

test("DeleteNoteDialog uses shadcn dialog form primitives and still requires a reason", () => {
	const source = readSource("src/components/DeleteNoteDialog.tsx");

	assert.match(source, /@\/components\/ui\/dialog/);
	assert.match(source, /@\/components\/ui\/radio-group/);
	assert.match(source, /@\/components\/ui\/textarea/);
	assert.match(source, /@\/components\/ui\/button/);
	assert.match(source, /<Dialog/);
	assert.match(source, /<DialogTitle/);
	assert.match(source, /<RadioGroup/);
	assert.match(source, /<Textarea/);
	assert.match(source, /disabled=\{!reason \|\| isPending\}/);
	assert.doesNotMatch(source, /fixed inset-0/);
});

test("Settings page uses shadcn controls instead of native form primitives", () => {
	const source = readSource("src/pages/SettingsPage.tsx");

	assert.match(source, /@\/components\/ui\/select/);
	assert.match(source, /@\/components\/ui\/field/);
	assert.match(source, /@\/components\/ui\/input/);
	assert.match(source, /@\/components\/ui\/button/);
	assert.match(source, /@\/components\/ui\/switch/);
	assert.match(source, /@\/components\/ui\/alert-dialog/);
	assert.match(source, /<Select/);
	assert.match(source, /<SelectGroup/);
	assert.match(source, /<FieldGroup/);
	assert.match(source, /<Input/);
	assert.match(source, /<Button/);
	assert.match(source, /<Switch/);
	assert.match(source, /<AlertDialog/);
	assert.match(source, /\[&>\[data-slot=field-label\]\]:flex-none/);
	assert.match(source, /justify-start/);
	assert.doesNotMatch(source, /justify-end text-xs text-muted-foreground/);
	assert.doesNotMatch(source, /<select\b/);
	assert.doesNotMatch(source, /<input\b/);
	assert.doesNotMatch(source, /<button\b/);
	assert.doesNotMatch(source, /ConfirmDialog/);
	assert.equal(
		existsSync(path.join(root, "src/components/ConfirmDialog.tsx")),
		false,
	);
});

test("Settings provider select dropdown width is locked to the trigger width", () => {
	const source = readSource("src/pages/SettingsPage.tsx");

	assert.match(source, /<SelectTrigger className="w-72" size="sm">/);
	assert.match(source, /<SelectContent\s+position="popper"\s+align="start"\s+className="w-\(--radix-select-trigger-width\) min-w-\(--radix-select-trigger-width\)"/);
});

test("Settings data source names stay on one line", () => {
	const source = readSource("src/pages/SettingsPage.tsx");

	assert.match(source, /"w-32 whitespace-nowrap font-medium"/);
	assert.doesNotMatch(source, /"w-24 font-medium"/);
});

test("source colors are centralized behind theme variables", () => {
	const settingsSource = readSource("src/pages/SettingsPage.tsx");
	const conversationsSource = readSource("src/pages/Conversations.tsx");
	const sourceColors = readSource("src/lib/source-colors.ts");

	assert.match(settingsSource, /getSourceColor/);
	assert.match(conversationsSource, /SOURCE_CONFIG/);
	assert.match(conversationsSource, /getSourceColor/);
	assert.match(sourceColors, /var\(--source-claude-code\)/);
	assert.match(sourceColors, /var\(--source-codex\)/);
	assert.match(sourceColors, /var\(--source-cursor\)/);
	assert.match(sourceColors, /var\(--source-trae\)/);
	assert.match(sourceColors, /var\(--source-copilot\)/);
	assert.doesNotMatch(settingsSource, /SOURCE_COLORS/);
	assert.doesNotMatch(conversationsSource, /#[0-9a-fA-F]{6}/);
});

test("Sidebar lets Electron cloud mode upload local history without CLI instructions", () => {
	const source = readSource("src/components/Sidebar.tsx");

	assert.match(source, /chatcrystalElectronCloud\?\.uploadLocalHistory/);
	assert.match(source, /canUploadLocalHistoryToCloud/);
	assert.match(source, /startCloudUpload/);
	assert.match(source, /import\.cloud_upload_action/);
	assert.match(source, /import\.cloud_import_hint/);
	assert.match(source, /\['status'\]/);
	assert.match(source, /\['conversations'\]/);
	assert.match(source, /\['notes'\]/);
});

test("RelationGraph uses graph color helpers instead of page-level hardcoded palettes", () => {
	const graphSource = readSource("src/pages/RelationGraph.tsx");

	assert.match(graphSource, /@\/lib\/graph-colors/);
	assert.match(graphSource, /getGraphProjectColor/);
	assert.match(graphSource, /withAlpha/);
	assert.doesNotMatch(graphSource, /EDGE_COLORS/);
	assert.doesNotMatch(graphSource, /PROJECT_COLORS/);
	assert.doesNotMatch(graphSource, /#[0-9a-fA-F]{6}/);
});

test("RelationGraph uses Sigma and Graphology instead of react-force-graph", () => {
	const graphSource = readSource("src/pages/RelationGraph.tsx");
	const canvasSource = readSource("src/components/RelationGraphCanvas.tsx");

	assert.match(canvasSource, /@react-sigma\/core/);
	assert.match(canvasSource, /graphology/);
	assert.match(canvasSource, /graphology-layout/);
	assert.match(canvasSource, /graphology-layout-forceatlas2/);
	assert.doesNotMatch(graphSource, /react-force-graph-2d/);
	assert.doesNotMatch(canvasSource, /react-force-graph-2d/);
});

test("RelationGraph keeps Sigma stable while node hover updates the tooltip", () => {
	const graphSource = readSource("src/pages/RelationGraph.tsx");
	const canvasSource = readSource("src/components/RelationGraphCanvas.tsx");

	assert.match(graphSource, /useCallback/);
	assert.match(graphSource, /handleNodeHover/);
	assert.match(graphSource, /handleNodeClick/);
	assert.match(canvasSource, /const sigmaSettings = useMemo/);
	assert.match(canvasSource, /settings=\{sigmaSettings\}/);
	assert.match(canvasSource, /memo\(RelationGraphCanvasComponent\)/);
});

test("RelationGraph defaults to a tag knowledge graph projection", () => {
	const graphSource = readSource("src/pages/RelationGraph.tsx");
	const apiSource = readSource("src/lib/api.ts");

	assert.match(graphSource, /level: 'tag'/);
	assert.match(graphSource, /GRAPH_TAG_PROJECTION_LIMIT/);
	assert.match(graphSource, /minScore/);
	assert.doesNotMatch(graphSource, /relationType: selectedType/);
	assert.match(apiSource, /level\?: "tag" \| "note"/);
});

test("RelationGraph keeps the previous projection visible while strength filters refetch", () => {
	const graphSource = readSource("src/pages/RelationGraph.tsx");

	assert.match(graphSource, /queryKey: \['relation-graph', 'tag', selectedStrengthConfig\.minScore\]/);
	assert.match(graphSource, /placeholderData: \(previousData\) => previousData/);
});

test("RelationGraph opens a tag detail panel using notes filtered by tag", () => {
	const graphSource = readSource("src/pages/RelationGraph.tsx");

	assert.match(graphSource, /selectedTag/);
	assert.match(graphSource, /api\.getNotes\(\{/);
	assert.match(graphSource, /tag: selectedTag\.name/);
	assert.match(graphSource, new RegExp("navigate\\(`/notes/\\$\\{note\\.id\\}`\\)"));
	assert.match(graphSource, /graph\.tag_detail/);
});

test("RelationGraph separates hover preview from the right-side tag detail panel", () => {
	const graphSource = readSource("src/pages/RelationGraph.tsx");

	assert.match(graphSource, /data-graph-hover-card/);
	assert.match(graphSource, /absolute top-4 left-4/);
	assert.match(graphSource, /data-graph-hover-tag-pill/);
	assert.match(graphSource, /data-graph-hover-tag-pill[\s\S]*border border-border/);
	assert.doesNotMatch(graphSource, /right-\[calc\(22\.5rem\+1\.5rem\)\]/);
});

test("RelationGraph keeps tag detail metrics compact in the panel header", () => {
	const graphSource = readSource("src/pages/RelationGraph.tsx");

	assert.match(graphSource, /data-graph-detail-metrics/);
	assert.match(graphSource, /data-graph-detail-metrics[\s\S]*graph\.tag_detail_notes/);
	assert.match(graphSource, /data-graph-detail-metrics[\s\S]*graph\.connections/);
	assert.doesNotMatch(graphSource, /grid shrink-0 grid-cols-2 gap-2 border-b border-border px-4 py-3 text-xs/);
});

test("RelationGraph gives hover and detail overlays directional reduced-motion-safe entrance feedback", () => {
	const graphSource = readSource("src/pages/RelationGraph.tsx");

	assert.match(graphSource, /data-graph-hover-card[\s\S]*motion-safe:animate-in/);
	assert.match(graphSource, /data-graph-hover-card[\s\S]*motion-safe:fade-in/);
	assert.match(graphSource, /data-graph-hover-card[\s\S]*motion-safe:slide-in-from-left-2/);
	assert.match(graphSource, /data-graph-hover-card[\s\S]*motion-reduce:animate-none/);
	assert.match(graphSource, /data-graph-detail-panel[\s\S]*motion-safe:animate-in/);
	assert.match(graphSource, /data-graph-detail-panel[\s\S]*motion-safe:fade-in/);
	assert.match(graphSource, /data-graph-detail-panel[\s\S]*motion-safe:slide-in-from-right-3/);
	assert.match(graphSource, /data-graph-detail-panel[\s\S]*motion-reduce:animate-none/);
});

test("RelationGraph uses a theme-specific neutral tag edge color instead of the accent color", () => {
	const graphSource = readSource("src/pages/RelationGraph.tsx");
	const colorSource = readSource("src/lib/graph-colors.ts");

	assert.match(colorSource, /edge: readThemeColor\("--graph-edge-references"/);
	assert.match(colorSource, /activeEdge: readThemeColor\("--accent-hover"/);
	assert.match(graphSource, /canvasColors\.edge/);
	assert.match(graphSource, /TAG_EDGE_ALPHA_BASE = 0\.065/);
	assert.match(graphSource, /TAG_EDGE_ALPHA_SCALE = 0\.12/);
	assert.match(graphSource, /TAG_EDGE_SIZE_BASE = 0\.36/);
	assert.match(graphSource, /TAG_EDGE_SIZE_SCALE = 1\.65/);
	assert.match(graphSource, /withAlpha\(canvasColors\.edge, TAG_EDGE_ALPHA_BASE \+ score \* TAG_EDGE_ALPHA_SCALE\)/);
	assert.match(graphSource, /size: TAG_EDGE_SIZE_BASE \+ score \* TAG_EDGE_SIZE_SCALE/);
	assert.doesNotMatch(graphSource, /canvasColors\.accent, 0\.1 \+ score \* 0\.28/);
	assert.doesNotMatch(graphSource, /withAlpha\(canvasColors\.edge, 0\.1 \+ score \* 0\.16\)/);
	assert.doesNotMatch(graphSource, /size: 0\.45 \+ score \* 2\.3/);
});

test("RelationGraph keeps hover and selected tag focus active in the Sigma canvas", () => {
	const graphSource = readSource("src/pages/RelationGraph.tsx");

	assert.match(graphSource, /const focusedGraphNode = hoveredNode \?\? selectedTag/);
	assert.match(graphSource, /focusedNodeKey=\{focusedGraphNode \? `\$\{focusedGraphNode\.kind\}:\$\{focusedGraphNode\.id\}` : null\}/);
});

test("RelationGraphCanvas dims unrelated graph items and highlights the focused neighborhood", () => {
	const canvasSource = readSource("src/components/RelationGraphCanvas.tsx");
	const hoverRendererSource = readFunctionBlock(
		canvasSource,
		"function drawThemeNodeHover",
		"function SigmaGraphReducers",
	);

	assert.match(canvasSource, /useSetSettings/);
	assert.match(canvasSource, /focusedNodeKey/);
	assert.match(canvasSource, /focusedNeighborKeys/);
	assert.match(canvasSource, /focusedEdgeKeys/);
	assert.match(canvasSource, /graph\.edges\(focusedNodeKey\)/);
	assert.match(canvasSource, /graph\.extremities\(edge\)/);
	assert.match(canvasSource, /const isFocused = hasFocus && node === focusedNodeKey/);
	assert.match(canvasSource, /const isRelated = hasFocus && focusedNeighborKeys\.has\(node\)/);
	assert.match(canvasSource, /isDimmed/);
	assert.match(canvasSource, /withAlpha\(colors\.dimmedNode/);
	assert.match(canvasSource, /withAlpha\(colors\.dimmedEdge/);
	assert.match(canvasSource, /withAlpha\(colors\.activeEdge/);
	assert.match(canvasSource, /highlighted: isFocused/);
	assert.match(canvasSource, /forceLabel: !isDimmed && \(isFocused \|\| shouldShowLabel\)/);
	assert.match(canvasSource, /label: isDimmed \? null : data\.title/);
	assert.match(canvasSource, /defaultDrawNodeHover/);
	assert.match(canvasSource, /defaultDrawNodeLabel/);
	assert.match(canvasSource, /drawThemeNodeHover/);
	assert.match(canvasSource, /drawThemeNodeLabel/);
	assert.match(canvasSource, /colors\.hoverBackground/);
	assert.match(canvasSource, /measureText/);
	assert.match(canvasSource, /fillText/);
	assert.doesNotMatch(hoverRendererSource, /measureText/);
	assert.doesNotMatch(hoverRendererSource, /fillText/);
});

test("RelationGraph removes the top header and moves tools to the lower left canvas controls", () => {
	const graphSource = readSource("src/pages/RelationGraph.tsx");

	assert.doesNotMatch(graphSource, /border-b border-theme bg-secondary px-4 py-3/);
	assert.match(graphSource, /data-graph-control-panel/);
	assert.match(graphSource, /data-graph-stats-panel/);
	assert.match(graphSource, /data-graph-action-row/);
	assert.match(graphSource, /data-graph-view-controls/);
	assert.match(graphSource, /data-graph-strength-filters/);
	assert.match(graphSource, /absolute bottom-3 left-3 flex w-fit max-w-\[calc\(100%-1\.5rem\)\] flex-col gap-2/);
	assert.match(graphSource, /data-graph-stats-panel[\s\S]*w-full/);
	assert.match(graphSource, /data-graph-action-row[\s\S]*flex w-fit max-w-full items-center gap-2/);
	assert.match(graphSource, /data-graph-action-row[\s\S]*data-graph-view-controls[\s\S]*data-graph-strength-filters/);
	assert.match(graphSource, /data-graph-view-controls[\s\S]*shrink-0/);
	assert.match(graphSource, /data-graph-strength-filters[\s\S]*w-fit/);
	assert.doesNotMatch(graphSource, /w-\[22rem\]/);
	assert.doesNotMatch(graphSource, /data-graph-strength-filters[\s\S]*flex-1/);
	assert.match(graphSource, /graph\.strength\./);
	assert.doesNotMatch(graphSource, /GRAPH_RELATION_TYPES/);
});

test("RelationGraphCanvas renders full tag labels instead of truncated note titles", () => {
	const canvasSource = readSource("src/components/RelationGraphCanvas.tsx");

	assert.match(canvasSource, /kind: 'tag'/);
	assert.match(canvasSource, /label: isDimmed \? null : data\.title/);
	assert.doesNotMatch(canvasSource, /formatNodeLabel/);
	assert.doesNotMatch(canvasSource, /slice\(0,/);
});
