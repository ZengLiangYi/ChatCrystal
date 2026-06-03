import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

function readSource(relativePath: string) {
	return readFileSync(path.join(root, relativePath), "utf-8");
}

test("NoteDetail gates original conversation navigation on API availability", () => {
	const source = readSource("src/pages/NoteDetail.tsx");

	assert.match(source, /can_open_original_conversation/);
	assert.match(source, /\{canOpenOriginalConversation && \(/);
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

test("Search page uses shadcn search controls", () => {
	const source = readSource("src/pages/SearchPage.tsx");

	assert.match(source, /@\/components\/ui\/button/);
	assert.match(source, /@\/components\/ui\/input/);
	assert.match(source, /@\/components\/ui\/checkbox/);
	assert.match(source, /<Input/);
	assert.match(source, /<Button/);
	assert.match(source, /<Checkbox/);
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
