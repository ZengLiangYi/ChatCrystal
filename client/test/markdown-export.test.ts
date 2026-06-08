import assert from "node:assert/strict";
import test from "node:test";

import { createNoteMarkdownExport } from "../src/lib/markdown-export.ts";

const exportedAt = new Date(2026, 5, 8, 18, 30, 5);

function pad2(value: number) {
	return String(value).padStart(2, "0");
}

function expectedLocalExportedAt(date: Date) {
	const offsetMinutes = -date.getTimezoneOffset();
	const offsetSign = offsetMinutes >= 0 ? "+" : "-";
	const absoluteOffset = Math.abs(offsetMinutes);
	return [
		`${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
		`${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`,
		`GMT${offsetSign}${pad2(Math.floor(absoluteOffset / 60))}:${pad2(absoluteOffset % 60)}`,
	].join(" ");
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const localExportedAt = expectedLocalExportedAt(exportedAt);
const localExportedAtPattern = new RegExp(`exported_at: "${escapeRegExp(localExportedAt)}"`);

test("exports a note with minimal frontmatter and markdown body", () => {
	const exported = createNoteMarkdownExport(
		{
			id: 42,
			title: "Fix: export notes",
			summary: "This **summary** stays markdown.",
			key_conclusions: ["Keep metadata small", "Use browser download"],
			code_snippets: [
				{
					language: "ts",
					description: "Downloader helper",
					code: "export function download() {\n  return true;\n}",
				},
			],
			source_type: "agent-writeback",
			tags: ["markdown", "export"],
		},
		{ exportedAt },
	);

	assert.equal(exported.filename, "42-fix-export-notes.md");
	assert.equal(
		exported.content,
		`---
title: "Fix: export notes"
tags:
  - markdown
  - export
source_type: agent-writeback
exported_at: "${localExportedAt}"
---

# Fix: export notes

## Summary

This **summary** stays markdown.

## Key Conclusions

- Keep metadata small
- Use browser download

## Code Snippets

### Downloader helper

\`\`\`ts
export function download() {
  return true;
}
\`\`\`
`,
	);
});

test("omits empty optional fields and internal metadata", () => {
	const exported = createNoteMarkdownExport(
		{
			id: 7,
			title: "Plain note",
			summary: "",
			key_conclusions: [],
			code_snippets: [],
			source_type: "",
			tags: [],
			conversation_id: "codex:secret",
			project_dir: "C:\\Users\\Rayner\\Project\\ChatCrystal",
			project_key: "git:secret",
			files_touched: ["secret.ts"],
			error_signatures: ["secret error"],
		},
		{ exportedAt },
	);

	assert.match(
		exported.content,
		new RegExp(`^---\\ntitle: Plain note\\nexported_at: "${escapeRegExp(localExportedAt)}"\\n---`),
	);
	assert.doesNotMatch(exported.content, /exported_at: 2026-06-08T10:00:00\.000Z/);
	assert.doesNotMatch(exported.content, /conversation_id/);
	assert.doesNotMatch(exported.content, /project_dir/);
	assert.doesNotMatch(exported.content, /project_key/);
	assert.doesNotMatch(exported.content, /files_touched/);
	assert.doesNotMatch(exported.content, /error_signatures/);
	assert.doesNotMatch(exported.content, /## Summary/);
	assert.doesNotMatch(exported.content, /## Key Conclusions/);
	assert.doesNotMatch(exported.content, /## Code Snippets/);
});

test("escapes yaml values, code fences, and unsafe filenames", () => {
	const exported = createNoteMarkdownExport(
		{
			id: 9,
			title: "A: title / with * unsafe?",
			summary: "Summary",
			key_conclusions: [],
			code_snippets: [
				{
					language: "",
					description: "",
					code: "const fence = ```;\n",
				},
			],
			source_type: "manual-note",
			tags: ["needs:quotes", "line\nbreak"],
		},
		{ exportedAt },
	);

	assert.equal(exported.filename, "9-a-title-with-unsafe.md");
	assert.match(exported.content, /title: "A: title \/ with \* unsafe\?"/);
	assert.match(exported.content, localExportedAtPattern);
	assert.match(exported.content, / {2}- "needs:quotes"/);
	assert.match(exported.content, / {2}- "line\\nbreak"/);
	assert.match(exported.content, /\n````text\nconst fence = ```;\n\n````\n/);
});

test("uses caller-provided section labels for localized exports", () => {
	const exported = createNoteMarkdownExport(
		{
			id: 10,
			title: "中文导出",
			summary: "摘要内容",
			key_conclusions: ["结论一"],
			code_snippets: [
				{
					language: "ts",
					description: "示例代码",
					code: "const value = true;",
				},
			],
		},
		{
			exportedAt,
			labels: {
				summary: "摘要",
				keyConclusions: "关键结论",
				codeSnippets: "代码片段",
			},
		},
	);

	assert.match(exported.content, /## 摘要\n\n摘要内容/);
	assert.match(exported.content, /## 关键结论\n\n- 结论一/);
	assert.match(exported.content, /## 代码片段\n\n### 示例代码/);
	assert.doesNotMatch(exported.content, /## Summary/);
	assert.doesNotMatch(exported.content, /## Key Conclusions/);
	assert.doesNotMatch(exported.content, /## Code Snippets/);
});
