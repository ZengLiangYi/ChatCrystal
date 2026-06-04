import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getOnboardingUrl } from "../onboarding-page.js";

const electronRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

test("electron onboarding helper points dev mode at Vite static assets", () => {
	const url = getOnboardingUrl({
		appPath: "C:\\fake\\ChatCrystal",
		devBaseUrl: "http://localhost:13721",
		initialError: "云端连接失败",
	});

	assert.equal(
		url,
		"http://localhost:13721/electron-onboarding/index.html?initialError=%E4%BA%91%E7%AB%AF%E8%BF%9E%E6%8E%A5%E5%A4%B1%E8%B4%A5",
	);
});

test("electron onboarding helper points packaged mode at built static assets", () => {
	const url = getOnboardingUrl({
		appPath: "C:\\fake\\ChatCrystal",
		initialError: "本地核心启动失败",
	});

	assert.match(
		url,
		/^file:\/\/\/C:\/fake\/ChatCrystal\/client\/dist\/electron-onboarding\/index\.html\?initialError=/,
	);
});

test("electron onboarding helper is not an embedded HTML generator", () => {
	const source = readFileSync(
		path.join(electronRoot, "onboarding-page.ts"),
		"utf-8",
	);

	assert.doesNotMatch(source, /<!doctype html>/);
	assert.doesNotMatch(source, /<style>/);
	assert.doesNotMatch(source, /超级大脑/);
	assert.doesNotMatch(source, /正在唤醒您的超级大脑/);
	assert.match(source, /electron-onboarding\/index\.html/);
});
