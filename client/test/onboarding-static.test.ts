import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const onboardingRoot = path.join(root, "electron-onboarding");

test("onboarding html entry is only a thin Vite React entry", () => {
	const htmlPath = path.join(onboardingRoot, "index.html");
	assert.equal(existsSync(htmlPath), true);

	const html = readFileSync(htmlPath, "utf-8");
	assert.match(html, /<div id="root"><\/div>/);
	assert.match(html, /\/src\/onboarding\/main\.tsx/);
	assert.doesNotMatch(html, /onboarding\.css/);
	assert.doesNotMatch(html, /onboarding\.js/);
	assert.doesNotMatch(html, /class="workspace"/);
	assert.doesNotMatch(html, /data-i18n/);
	assert.doesNotMatch(html, /连接记忆库/);
	assert.doesNotMatch(html, /超级大脑/);
});

test("vite builds the onboarding page as a separate React entry", () => {
	const config = readFileSync(path.join(root, "vite.config.ts"), "utf-8");

	assert.match(config, /rollupOptions/);
	assert.match(config, /input/);
	assert.match(config, /index:\s*resolve\(__dirname,\s*["']index\.html["']\)/);
	assert.match(
		config,
		/onboarding:\s*resolve\(__dirname,\s*["']electron-onboarding\/index\.html["']\)/,
	);
});

test("legacy handwritten onboarding public assets are removed", () => {
	const legacyRoot = path.join(root, "public/electron-onboarding");

	assert.equal(existsSync(path.join(legacyRoot, "index.html")), false);
	assert.equal(existsSync(path.join(legacyRoot, "onboarding.css")), false);
	assert.equal(existsSync(path.join(legacyRoot, "onboarding.js")), false);
});

test("React onboarding entry owns preview mode, IPC, and language switching", () => {
	const appPath = path.join(root, "src/onboarding/OnboardingApp.tsx");
	const mainPath = path.join(root, "src/onboarding/main.tsx");
	assert.equal(existsSync(appPath), true);
	assert.equal(existsSync(mainPath), true);

	const app = readFileSync(appPath, "utf-8");
	const main = readFileSync(mainPath, "utf-8");

	assert.match(main, /createRoot/);
	assert.match(main, /OnboardingApp/);
	assert.match(app, /@\/components\/AccessShell/);
	assert.match(app, /preview=1/);
	assert.match(app, /createPreviewApi/);
	assert.match(app, /window\.chatcrystalOnboarding/);
	assert.match(app, /window\.electronAPI\?\.windowControls/);
	assert.match(app, /onLanguageChange/);
	assert.doesNotMatch(app, /首次启动/);
	assert.doesNotMatch(app, /First run/);
	assert.doesNotMatch(app, /超级大脑/);
});

test("AccessShell centralizes the access-layer shell visuals", () => {
	const shellPath = path.join(root, "src/components/AccessShell.tsx");
	assert.equal(existsSync(shellPath), true);

	const shell = readFileSync(shellPath, "utf-8");

	assert.match(shell, /dawnHaze/);
	assert.match(shell, /themeToCSSVars/);
	assert.match(shell, /\/icon\.png/);
	assert.match(shell, /size-7/);
	assert.match(shell, /brand\.name/);
	assert.match(shell, /windowControls/);
	assert.match(shell, /ToggleGroup/);
	assert.match(shell, /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(420px,520px\)\]/);
	assert.doesNotMatch(shell, /Sparkles/);
	assert.doesNotMatch(shell, /workspace_label/);
});

test("onboarding status cards keep copy compact", () => {
	const zh = JSON.parse(readFileSync(path.join(root, "src/i18n/zh.json"), "utf-8"));
	const en = JSON.parse(readFileSync(path.join(root, "src/i18n/en.json"), "utf-8"));

	for (const key of ["status_local", "status_secure", "status_ready"]) {
		assert.ok(
			zh.onboarding_flow[key].length <= 6,
			`Chinese ${key} should stay compact`,
		);
		assert.ok(
			en.onboarding_flow[key].length <= 14,
			`English ${key} should stay compact`,
		);
	}
});
