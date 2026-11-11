import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

// ---------------------------------------------------------------------------
// Self-contained fixture: a fake Roo Code globalStorage root under a temp dir.
// The data-dir env var must be set before the adapter is imported.
// ---------------------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), "chatcrystal-roo-test-"));
const rooDir = join(root, "roo-global-storage");

process.env.DATA_DIR = join(root, "data");
process.env.ROO_DATA_DIR = rooDir;
// A real WSL distro may be running on this machine; keep it out of the tests.
process.env.CHATCRYSTAL_WSL = "0";

const { rooAdapter } = await import("./roo.js");
const { setWslHomesForTesting } = await import("../wsl.js");

after(() => {
	setWslHomesForTesting(null);
	rmSync(root, { recursive: true, force: true });
});

function writeJson(filePath: string, value: unknown): void {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function normalizePath(filePath: string): string {
	return filePath.replace(/\\/g, "/");
}

const TASK_WITH_META = "roo-task-1";
const TASK_NO_META = "roo-task-2";
const TASK_BROKEN = "roo-task-3";
const BASE_MS = 1780000000000;

let fixturesReady = false;

function ensureFixtures(): void {
	if (fixturesReady) return;
	fixturesReady = true;

	const tasksDir = join(rooDir, "tasks");

	// A native-tool-calling task: Anthropic content blocks, `<task>` envelope,
	// thinking block, tool_use block and a history_item.json beside it.
	writeJson(join(tasksDir, TASK_WITH_META, "api_conversation_history.json"), [
		{
			role: "user",
			content: [{ type: "text", text: "<task>\nFix the failing test\n</task>" }],
		},
		{
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "The test asserts stale state." },
				{ type: "text", text: "Looking at the test first." },
				{
					type: "tool_use",
					id: "tool-1",
					name: "read_file",
					input: { path: "test/parser.test.ts" },
				},
			],
		},
		{
			role: "user",
			content: [{ type: "tool_result", tool_use_id: "tool-1", content: "done" }],
		},
		{ role: "assistant", content: "Test passes now." },
	]);
	writeJson(join(tasksDir, TASK_WITH_META, "history_item.json"), {
		id: TASK_WITH_META,
		ts: BASE_MS,
		task: "<task>Fix the failing test</task>",
		workspace: "/work/roo-app",
	});

	// A task without history_item.json: projectDir and start time must fall back.
	writeJson(join(tasksDir, TASK_NO_META, "api_conversation_history.json"), [
		{ role: "user", content: "Explain the cache" },
		{ role: "assistant", content: "It stores recent results." },
	]);

	// A truncated transcript with a valid history_item: scan lists it, parse
	// must return zero messages instead of throwing.
	mkdirSync(join(tasksDir, TASK_BROKEN), { recursive: true });
	writeFileSync(
		join(tasksDir, TASK_BROKEN, "api_conversation_history.json"),
		'[{"role": "user"',
		"utf-8",
	);
	writeJson(join(tasksDir, TASK_BROKEN, "history_item.json"), {
		id: TASK_BROKEN,
		ts: 1780100000000,
		task: "Broken roo task",
		workspace: "/work/roo-broken",
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("detect returns null when the Roo store is absent", async () => {
	assert.equal(await rooAdapter.detect(), null);
	assert.deepEqual(rooAdapter.watchPaths?.() ?? [], []);
});

test("detect counts Roo tasks", async () => {
	ensureFixtures();
	const info = await rooAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "roo");
	assert.equal(info.displayName, "Roo Code");
	assert.equal(info.dataDir, rooDir);
	assert.equal(info.conversationCount, 3);
});

test("scan reports task ids, source and workspace project dirs", async () => {
	ensureFixtures();
	const metas = await rooAdapter.scan();
	assert.equal(metas.length, 3);

	const withMeta = metas.find((meta) => meta.id === TASK_WITH_META);
	assert.ok(withMeta);
	assert.equal(withMeta.source, "roo");
	assert.equal(withMeta.projectDir, "/work/roo-app");
	assert.ok(normalizePath(withMeta.filePath).endsWith("tasks/roo-task-1/api_conversation_history.json"));
	assert.ok(withMeta.fileSize > 0);

	const noMeta = metas.find((meta) => meta.id === TASK_NO_META);
	assert.ok(noMeta);
	assert.equal(noMeta.projectDir, "");
});

test("parse unwraps <task>, keeps thinking/tool flags and history timing", async () => {
	ensureFixtures();
	const metas = await rooAdapter.scan();
	const meta = metas.find((item) => item.id === TASK_WITH_META);
	assert.ok(meta);

	const parsed = await rooAdapter.parse(meta);
	assert.equal(parsed.id, TASK_WITH_META);
	assert.equal(parsed.source, "roo");
	assert.equal(parsed.slug, "Fix the failing test");
	assert.equal(parsed.projectDir, "/work/roo-app");
	assert.equal(parsed.projectName, "roo-app");
	assert.equal(parsed.cwd, "/work/roo-app");
	assert.equal(parsed.gitBranch, null);

	assert.equal(parsed.messages.length, 3);
	assert.deepEqual(
		parsed.messages.map((message) => [message.type, message.role]),
		[
			["user", "user"],
			["assistant", "assistant"],
			["assistant", "assistant"],
		],
	);
	assert.equal(parsed.messages[0]?.content, "Fix the failing test");
	assert.equal(parsed.messages[1]?.content, "Looking at the test first.");
	assert.equal(parsed.messages[1]?.hasToolUse, true);
	assert.equal(parsed.messages[1]?.thinking, "The test asserts stale state.");
	assert.equal(parsed.messages[2]?.content, "Test passes now.");

	const baseIso = new Date(BASE_MS).toISOString();
	assert.equal(parsed.messages[0]?.timestamp, baseIso);
	assert.equal(parsed.messages[1]?.timestamp, new Date(BASE_MS + 1000).toISOString());
	assert.equal(parsed.messages[2]?.timestamp, new Date(BASE_MS + 2000).toISOString());
	assert.equal(new Date(parsed.firstMessageAt).toISOString(), parsed.firstMessageAt);
	assert.equal(new Date(parsed.lastMessageAt).toISOString(), parsed.lastMessageAt);
});

test("parse falls back to the first prompt and file mtime without history_item", async () => {
	ensureFixtures();
	const metas = await rooAdapter.scan();
	const meta = metas.find((item) => item.id === TASK_NO_META);
	assert.ok(meta);

	const parsed = await rooAdapter.parse(meta);
	assert.equal(parsed.slug, "Explain the cache");
	assert.equal(parsed.projectDir, "");
	assert.equal(parsed.projectName, "Unknown");
	assert.equal(parsed.messages.length, 2);

	const baseMs = Date.parse(meta.fileMtime);
	assert.equal(parsed.messages[0]?.timestamp, new Date(baseMs).toISOString());
	assert.equal(parsed.messages[1]?.timestamp, new Date(baseMs + 1000).toISOString());
});

test("parse tolerates a corrupt task transcript", async () => {
	ensureFixtures();
	const metas = await rooAdapter.scan();
	const meta = metas.find((item) => item.id === TASK_BROKEN);
	assert.ok(meta);

	const parsed = await rooAdapter.parse(meta);
	assert.deepEqual(parsed.messages, []);
	assert.equal(parsed.projectDir, "/work/roo-broken");
	assert.equal(parsed.projectName, "roo-broken");
	assert.equal(parsed.slug, "Broken roo task");
});

test("watchPaths covers task transcripts and history items", () => {
	ensureFixtures();
	const paths = (rooAdapter.watchPaths?.() ?? []).map(normalizePath);
	assert.equal(paths.length, 2);
	assert.ok(paths[0]?.endsWith("tasks/**/api_conversation_history.json"));
	assert.ok(paths[1]?.endsWith("tasks/**/history_item.json"));
});

test("WSL distro tasks are detected, scanned and parsed from an extra root", async () => {
	ensureFixtures();
	const wslHome = join(root, "wsl-home");
	const wslRoot = join(
		wslHome,
		".vscode-server",
		"data",
		"User",
		"globalStorage",
		"rooveterinaryinc.roo-cline",
	);
	const wslTaskId = "roo-wsl-task";
	const wslTaskDir = join(wslRoot, "tasks", wslTaskId);
	writeJson(join(wslTaskDir, "api_conversation_history.json"), [
		{
			role: "user",
			content: [{ type: "text", text: "<task>Fix the WSL test</task>" }],
		},
		{
			role: "assistant",
			content: [
				{ type: "text", text: "WSL task handled." },
				{ type: "tool_use", id: "tool-wsl", name: "read_file", input: {} },
			],
		},
	]);
	writeJson(join(wslTaskDir, "history_item.json"), {
		id: wslTaskId,
		ts: 1792000000000,
		task: "<task>Fix the WSL test</task>",
		workspace: "/home/me/roo-wsl-app",
	});

	setWslHomesForTesting([wslHome]);
	try {
		const info = await rooAdapter.detect();
		assert.ok(info);
		// Three local tasks plus the task inside the WSL distro home.
		assert.equal(info.conversationCount, 4);
		// detect still reports the primary Windows root.
		assert.equal(info.dataDir, rooDir);

		const metas = await rooAdapter.scan();
		assert.equal(metas.length, 4);
		const wslMeta = metas.find((meta) => meta.id === wslTaskId);
		assert.ok(wslMeta);
		assert.equal(wslMeta.source, "roo");
		assert.equal(wslMeta.rootDir, wslRoot);
		assert.equal(wslMeta.projectDir, "/home/me/roo-wsl-app");
		assert.ok(normalizePath(wslMeta.filePath).includes("wsl-home"));
		assert.ok(
			normalizePath(wslMeta.filePath).endsWith(
				"roo-wsl-task/api_conversation_history.json",
			),
		);

		const parsed = await rooAdapter.parse(wslMeta);
		assert.equal(parsed.id, wslTaskId);
		assert.equal(parsed.slug, "Fix the WSL test");
		assert.equal(parsed.projectDir, "/home/me/roo-wsl-app");
		assert.equal(parsed.projectName, "roo-wsl-app");
		assert.equal(parsed.messages.length, 2);
		assert.equal(parsed.messages[0]?.content, "Fix the WSL test");
		assert.equal(parsed.messages[1]?.content, "WSL task handled.");
		assert.equal(parsed.messages[1]?.hasToolUse, true);
		assert.equal(parsed.messages[0]?.timestamp, new Date(1792000000000).toISOString());

		// The watcher must stay on local Windows paths only.
		const paths = (rooAdapter.watchPaths?.() ?? []).map(normalizePath);
		assert.equal(paths.length, 2);
		assert.ok(paths.every((entry) => !entry.includes("wsl-home")));
	} finally {
		setWslHomesForTesting(null);
	}
});
