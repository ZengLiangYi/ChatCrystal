import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { themeToCSSVars } from "../src/themes/theme.types.ts";
import { dawnHaze } from "../src/themes/dawn-haze.ts";

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
	assert.match(css, /--primary-foreground:\s*var\(--accent-foreground\)/);
	assert.match(css, /--destructive-foreground:\s*var\(--error-foreground\)/);
	assert.match(css, /--control-checked-foreground:/);
	assert.match(css, /--control-unchecked-foreground:\s*var\(--text-secondary\)/);
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

test("theme definitions provide foreground and source color tokens", () => {
	for (const file of [
		"src/themes/dark-workshop.ts",
		"src/themes/dawn-haze.ts",
		"src/themes/jade-abyss.ts",
	]) {
		const source = readFileSync(path.join(root, file), "utf-8");

		assert.match(source, /accentForeground:/, file);
		assert.match(source, /errorForeground:/, file);
		assert.match(source, /sourceClaudeCode:/, file);
		assert.match(source, /sourceCodex:/, file);
		assert.match(source, /sourceCursor:/, file);
		assert.match(source, /sourceTrae:/, file);
		assert.match(source, /sourceCopilot:/, file);
	}
});

test("theme definitions provide graph relation and project palette tokens", () => {
	const graphTokens = [
		"graphEdgeCausedBy",
		"graphEdgeLeadsTo",
		"graphEdgeResolvedBy",
		"graphEdgeSimilarTo",
		"graphEdgeContradicts",
		"graphEdgeDependsOn",
		"graphEdgeExtends",
		"graphEdgeReferences",
		"graphProject1",
		"graphProject2",
		"graphProject3",
		"graphProject4",
		"graphProject5",
		"graphProject6",
		"graphProject7",
		"graphProject8",
		"graphProject9",
		"graphProject10",
	];

	for (const file of [
		"src/themes/dark-workshop.ts",
		"src/themes/dawn-haze.ts",
		"src/themes/jade-abyss.ts",
	]) {
		const source = readFileSync(path.join(root, file), "utf-8");

		for (const token of graphTokens) {
			assert.match(source, new RegExp(`${token}:`), `${file} missing ${token}`);
		}
	}
});

test("theme css variable conversion preserves numbered graph palette token names", () => {
	const vars = themeToCSSVars(dawnHaze);

	assert.equal(vars["--graph-project-1"], dawnHaze.colors.graphProject1);
	assert.equal(vars["--graph-project-10"], dawnHaze.colors.graphProject10);
	assert.equal(vars["--graph-project1"], undefined);
	assert.equal(vars["--graph-project10"], undefined);
});

test("client falls back to Dawn Haze when no theme preference is saved", () => {
	const source = readFileSync(
		path.join(root, "src/providers/ThemeProvider.tsx"),
		"utf-8",
	);

	assert.match(source, /const DEFAULT_THEME = ['"]dawn-haze['"]/);
	assert.match(source, /if \(!raw\) return DEFAULT_THEME/);
	assert.match(source, /return DEFAULT_THEME/);
	assert.doesNotMatch(source, /if \(!raw\) return ['"]dark-workshop['"]/);
});
