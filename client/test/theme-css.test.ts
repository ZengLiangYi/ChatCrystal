import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("Electron title bar uses theme variables instead of a fixed theme color", () => {
	const css = readFileSync(path.join(root, "src/index.css"), "utf-8");
	const titlebarBlock = css.match(/\.app-titlebar\s*\{[^}]*\}/)?.[0] ?? "";

	assert.match(titlebarBlock, /var\(--bg-secondary\)/);
	assert.doesNotMatch(titlebarBlock, /rgba\(\s*16\s*,\s*17\s*,\s*19/i);
	assert.doesNotMatch(titlebarBlock, /#101113/i);
});

test("shadcn semantic tokens are bridged to ChatCrystal runtime theme variables", () => {
	const css = readFileSync(path.join(root, "src/index.css"), "utf-8");

	assert.match(css, /@theme inline/);
	assert.match(css, /--color-background:\s*var\(--background\)/);
	assert.match(css, /--background:\s*var\(--bg-primary\)/);
	assert.match(css, /--foreground:\s*var\(--text-primary\)/);
	assert.match(css, /--color-border:\s*var\(--border\)/);
	assert.match(css, /--color-ring:\s*var\(--accent\)/);
});

test("shadcn theme tokens do not override ChatCrystal legacy color utilities", () => {
	const css = readFileSync(path.join(root, "src/index.css"), "utf-8");

	assert.doesNotMatch(css, /--color-primary:/);
	assert.doesNotMatch(css, /--color-secondary:/);
	assert.doesNotMatch(css, /--color-muted:/);
	assert.match(css, /@utility text-primary \{ color: var\(--text-primary\); \}/);
	assert.match(css, /@utility text-secondary \{ color: var\(--text-secondary\); \}/);
	assert.match(css, /@utility text-muted \{ color: var\(--text-muted\); \}/);
	assert.match(css, /@utility bg-primary \{ background-color: var\(--bg-primary\); \}/);
	assert.match(css, /@utility bg-secondary \{ background-color: var\(--bg-secondary\); \}/);
});
