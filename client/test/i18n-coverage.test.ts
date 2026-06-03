import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

function readJson(relativePath: string): unknown {
	return JSON.parse(readFileSync(path.join(root, relativePath), "utf-8"));
}

function flattenKeys(value: unknown, prefix = ""): string[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return [prefix];
	}

	return Object.keys(value as Record<string, unknown>).flatMap((key) => {
		const next = prefix ? `${prefix}.${key}` : key;
		return flattenKeys((value as Record<string, unknown>)[key], next);
	});
}

test("Chinese and English locale files expose the same keys", () => {
	const zhKeys = new Set(flattenKeys(readJson("src/i18n/zh.json")));
	const enKeys = new Set(flattenKeys(readJson("src/i18n/en.json")));

	assert.deepEqual(
		[...zhKeys].filter((key) => !enKeys.has(key)).sort(),
		[],
		"English locale is missing keys present in Chinese locale",
	);
	assert.deepEqual(
		[...enKeys].filter((key) => !zhKeys.has(key)).sort(),
		[],
		"Chinese locale is missing keys present in English locale",
	);
});

test("client UI does not keep page-level handwritten bilingual strings", () => {
	const files = [
		"src/components/RelatedNotes.tsx",
		"src/pages/SearchPage.tsx",
		"src/pages/RelationGraph.tsx",
	];
	const forbiddenPatterns = [
		/\bisZh\s*\?/,
		/\bzh\s*:/,
		/\ben\s*:/,
		/\blabel_zh\b/,
		/\blabel_en\b/,
	];

	const violations = files.flatMap((file) => {
		const source = readFileSync(path.join(root, file), "utf-8");
		return forbiddenPatterns
			.filter((pattern) => pattern.test(source))
			.map((pattern) => `${file}: ${pattern}`);
	});

	assert.deepEqual(violations, []);
});
