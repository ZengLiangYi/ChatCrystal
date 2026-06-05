import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const electronRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

function readMainSource() {
	return readFileSync(path.join(electronRoot, "main.ts"), "utf-8");
}

test("main process uses 1280x800 as the unified default and minimum window size", () => {
	const source = readMainSource();

	assert.match(source, /const DEFAULT_WINDOW_WIDTH\s*=\s*1280/);
	assert.match(source, /const DEFAULT_WINDOW_HEIGHT\s*=\s*800/);
	assert.match(source, /const MIN_WINDOW_WIDTH\s*=\s*1280/);
	assert.match(source, /const MIN_WINDOW_HEIGHT\s*=\s*800/);
	assert.match(source, /width:\s*DEFAULT_WINDOW_WIDTH/);
	assert.match(source, /height:\s*DEFAULT_WINDOW_HEIGHT/);
	assert.match(source, /minWidth:\s*MIN_WINDOW_WIDTH/);
	assert.match(source, /minHeight:\s*MIN_WINDOW_HEIGHT/);
	assert.doesNotMatch(source, /minWidth:\s*900/);
	assert.doesNotMatch(source, /minHeight:\s*600/);
});

test("saved window state is clamped to the unified minimum before restore", () => {
	const source = readMainSource();

	assert.match(source, /function normalizeWindowState\(state: WindowState\): WindowState/);
	assert.match(source, /const width = Number\.isFinite\(state\.width\)/);
	assert.match(source, /const height = Number\.isFinite\(state\.height\)/);
	assert.match(source, /width:\s*Math\.max\(width,\s*MIN_WINDOW_WIDTH\)/);
	assert.match(source, /height:\s*Math\.max\(height,\s*MIN_WINDOW_HEIGHT\)/);
	assert.match(source, /return normalizeWindowState\(JSON\.parse\(data\) as WindowState\)/);
});
