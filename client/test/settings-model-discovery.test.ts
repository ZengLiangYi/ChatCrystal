import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("SettingsPage exposes model discovery without raw bilingual copy", () => {
	const source = readFileSync(path.join(root, "src/pages/SettingsPage.tsx"), "utf-8");

	assert.match(source, /discoverModels/);
	assert.match(source, /CommandInput/);
	assert.match(source, /settings\.models\.fetch/);
	assert.match(source, /settings\.models\.cloud_unsupported_hint/);
	assert.doesNotMatch(source, /云端模式暂不支持获取模型列表/);
	assert.doesNotMatch(source, /Fetch Models/);
});

test("SettingsPage exposes the OrcaRouter API key referral as a safe external link", () => {
	const source = readFileSync(path.join(root, "src/pages/SettingsPage.tsx"), "utf-8");

	assert.match(
		source,
		/https:\/\/www\.orcarouter\.ai\/ref\/ref_67516d927343232775e2/,
	);
	assert.match(source, /provider === "orcarouter"/);
	assert.match(source, /settings\.orcarouter\.get_api_key/);
	assert.match(source, /target="_blank"/);
	assert.match(source, /rel="noopener noreferrer"/);
});
