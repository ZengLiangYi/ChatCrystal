import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const electronRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

test("main process defaults the Electron shell to Dawn Haze", () => {
	const source = readFileSync(path.join(electronRoot, "main.ts"), "utf-8");

	assert.match(source, /DAWN_HAZE_WINDOW_BACKGROUND\s*=\s*["']#F6F4F0["']/);
	assert.match(source, /nativeTheme\.themeSource\s*=\s*["']light["']/);
	assert.match(source, /backgroundColor:\s*DAWN_HAZE_WINDOW_BACKGROUND/);
	assert.doesNotMatch(source, /nativeTheme\.themeSource\s*=\s*["']dark["']/);
	assert.doesNotMatch(source, /backgroundColor:\s*["']#101113["']/i);
});
