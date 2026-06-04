import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("AuthGate auth refresh is not recreated by translation changes", () => {
	const source = readFileSync(
		path.join(root, "src/components/AuthGate.tsx"),
		"utf-8",
	);

	assert.doesNotMatch(
		source,
		/useCallback\([\s\S]*?\},\s*\[\s*t\s*\]\s*\)/,
		"AuthGate refresh should not depend on t because language changes must not rerun auth checks",
	);
});

test("Onboarding preview route is available outside AuthGate", () => {
	const source = readFileSync(path.join(root, "src/App.tsx"), "utf-8");
	const authGateRouteIndex = source.indexOf("<AuthGate>");

	assert.notEqual(authGateRouteIndex, -1);
	assert.doesNotMatch(source, /path="\/onboarding"/);
	assert.doesNotMatch(source, /OnboardingPreview/);
	assert.doesNotMatch(source, /electron-onboarding/);
});

test("AuthGateScreen uses the modern onboarding shell and shared controls", () => {
	const source = readFileSync(
		path.join(root, "src/components/AuthGateScreen.tsx"),
		"utf-8",
	);

	assert.match(source, /@\/components\/AccessShell/);
	assert.match(source, /@\/components\/ui\/button/);
	assert.match(source, /@\/components\/ui\/input/);
	assert.match(source, /@\/components\/ui\/alert/);
	assert.match(source, /@\/components\/ui\/separator/);
	assert.match(source, /<AccessShell/);
	assert.doesNotMatch(source, /Sparkles/);
	assert.doesNotMatch(source, /brand\.name/);
	assert.doesNotMatch(source, /auth\.workspace_label/);
	assert.doesNotMatch(source, /<input\b/);
	assert.doesNotMatch(source, /<button\b/);
	assert.doesNotMatch(source, /flex min-h-screen w-screen items-center justify-center/);
	assert.doesNotMatch(source, /max-w-md/);
	assert.doesNotMatch(source, /shadow-xl/);
});

test("AuthGateScreen exposes language switching before authentication", () => {
	const shellSource = readFileSync(
		path.join(root, "src/components/AccessShell.tsx"),
		"utf-8",
	);
	const source = readFileSync(
		path.join(root, "src/components/AuthGateScreen.tsx"),
		"utf-8",
	);

	assert.match(shellSource, /LANGUAGE_OPTIONS/);
	assert.match(shellSource, /getSelectedLanguageCode/);
	assert.match(shellSource, /onLanguageChange/);
	assert.match(shellSource, /access\.language_switch/);
	assert.match(shellSource, /language_short\.\$\{code\}/);
	assert.match(source, /onLanguageChange/);
});
