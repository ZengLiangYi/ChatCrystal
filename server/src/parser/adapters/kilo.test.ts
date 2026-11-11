import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

// ---------------------------------------------------------------------------
// Self-contained fixture: a fake Kilo Code globalStorage root under a temp dir.
// The data-dir env var must be set before the adapter is imported.
// ---------------------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), "chatcrystal-kilo-test-"));
const kiloDir = join(root, "kilo-global-storage");

process.env.DATA_DIR = join(root, "data");
process.env.KILO_DATA_DIR = kiloDir;
// A real WSL distro may be running on this machine; keep it out of the tests.
process.env.CHATCRYSTAL_WSL = "0";

const { kiloAdapter } = await import("./kilo.js");
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

const TASK_ID = "kilo-task-1";
const TASK_BROKEN = "kilo-task-2";
const BASE_MS = 1785000000000;

let fixturesReady = false;

function ensureFixtures(): void {
	if (fixturesReady) return;
	fixturesReady = true;

	const tasksDir = join(kiloDir, "tasks");

	writeJson(join(tasksDir, TASK_ID, "api_conversation_history.json"), [
		{
			role: "user",
			content: [{ type: "text", text: "<task>Add a rate limiter</task>" }],
		},
		{
			role: "assistant",
			content: [
				{ type: "text", text: "Adding the limiter." },
				{
					type: "tool_use",
					id: "tool-1",
					name: "write_to_file",
					input: { path: "src/limiter.ts" },
				},
			],
		},
		{ role: "assistant", content: "Rate limiter is in place." },
	]);
	writeJson(join(tasksDir, TASK_ID, "history_item.json"), {
		id: TASK_ID,
		ts: BASE_MS,
		task: "Add a rate limiter",
		workspace: "/work/kilo-app",
	});

	// A truncated transcript with a valid history_item: scan lists it, parse
	// must return zero messages instead of throwing.
	mkdirSync(join(tasksDir, TASK_BROKEN), { recursive: true });
	writeFileSync(
		join(tasksDir, TASK_BROKEN, "api_conversation_history.json"),
		"{broken",
		"utf-8",
	);
	writeJson(join(tasksDir, TASK_BROKEN, "history_item.json"), {
		id: TASK_BROKEN,
		ts: 1785100000000,
		task: "Broken kilo task",
		workspace: "/work/kilo-broken",
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("detect returns null when the Kilo store is absent", async () => {
	assert.equal(await kiloAdapter.detect(), null);
	assert.deepEqual(kiloAdapter.watchPaths?.() ?? [], []);
});

test("detect counts Kilo tasks", async () => {
	ensureFixtures();
	const info = await kiloAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "kilo");
	assert.equal(info.displayName, "Kilo Code");
	assert.equal(info.dataDir, kiloDir);
	assert.equal(info.conversationCount, 2);
});

test("scan reports task ids, source and workspace project dirs", async () => {
	ensureFixtures();
	const metas = await kiloAdapter.scan();
	assert.equal(metas.length, 2);

	const task = metas.find((meta) => meta.id === TASK_ID);
	assert.ok(task);
	assert.equal(task.source, "kilo");
	assert.equal(task.projectDir, "/work/kilo-app");
	assert.ok(normalizePath(task.filePath).endsWith("tasks/kilo-task-1/api_conversation_history.json"));
});

test("parse unwraps <task>, flags tool use and uses history_item timing", async () => {
	ensureFixtures();
	const metas = await kiloAdapter.scan();
	const meta = metas.find((item) => item.id === TASK_ID);
	assert.ok(meta);

	const parsed = await kiloAdapter.parse(meta);
	assert.equal(parsed.id, TASK_ID);
	assert.equal(parsed.source, "kilo");
	assert.equal(parsed.slug, "Add a rate limiter");
	assert.equal(parsed.projectDir, "/work/kilo-app");
	assert.equal(parsed.projectName, "kilo-app");

	assert.equal(parsed.messages.length, 3);
	assert.equal(parsed.messages[0]?.type, "user");
	assert.equal(parsed.messages[0]?.content, "Add a rate limiter");
	assert.equal(parsed.messages[1]?.type, "assistant");
	assert.equal(parsed.messages[1]?.content, "Adding the limiter.");
	assert.equal(parsed.messages[1]?.hasToolUse, true);
	assert.equal(parsed.messages[2]?.content, "Rate limiter is in place.");

	assert.equal(parsed.messages[0]?.timestamp, new Date(BASE_MS).toISOString());
	assert.equal(parsed.messages[1]?.timestamp, new Date(BASE_MS + 1000).toISOString());
	assert.equal(parsed.messages[2]?.timestamp, new Date(BASE_MS + 2000).toISOString());
});

test("parse tolerates a corrupt task transcript", async () => {
	ensureFixtures();
	const metas = await kiloAdapter.scan();
	const meta = metas.find((item) => item.id === TASK_BROKEN);
	assert.ok(meta);

	const parsed = await kiloAdapter.parse(meta);
	assert.deepEqual(parsed.messages, []);
	assert.equal(parsed.projectDir, "/work/kilo-broken");
	assert.equal(parsed.projectName, "kilo-broken");
	assert.equal(parsed.slug, "Broken kilo task");
});

test("watchPaths covers task transcripts and history items", () => {
	ensureFixtures();
	const paths = (kiloAdapter.watchPaths?.() ?? []).map(normalizePath);
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
		"kilocode.kilo-code",
	);
	const wslTaskId = "kilo-wsl-task";
	const wslTaskDir = join(wslRoot, "tasks", wslTaskId);
	writeJson(join(wslTaskDir, "api_conversation_history.json"), [
		{
			role: "user",
			content: [{ type: "text", text: "<task>Add a WSL limiter</task>" }],
		},
		{
			role: "assistant",
			content: [
				{ type: "text", text: "WSL limiter added." },
				{ type: "tool_use", id: "tool-wsl", name: "write_to_file", input: {} },
			],
		},
	]);
	writeJson(join(wslTaskDir, "history_item.json"), {
		id: wslTaskId,
		ts: 1793000000000,
		task: "<task>Add a WSL limiter</task>",
		workspace: "/home/me/kilo-wsl-app",
	});

	setWslHomesForTesting([wslHome]);
	try {
		const info = await kiloAdapter.detect();
		assert.ok(info);
		// Two local tasks plus the task inside the WSL distro home.
		assert.equal(info.conversationCount, 3);
		// detect still reports the primary Windows root.
		assert.equal(info.dataDir, kiloDir);

		const metas = await kiloAdapter.scan();
		assert.equal(metas.length, 3);
		const wslMeta = metas.find((meta) => meta.id === wslTaskId);
		assert.ok(wslMeta);
		assert.equal(wslMeta.source, "kilo");
		assert.equal(wslMeta.rootDir, wslRoot);
		assert.equal(wslMeta.projectDir, "/home/me/kilo-wsl-app");
		assert.ok(normalizePath(wslMeta.filePath).includes("wsl-home"));
		assert.ok(
			normalizePath(wslMeta.filePath).endsWith(
				"kilo-wsl-task/api_conversation_history.json",
			),
		);

		const parsed = await kiloAdapter.parse(wslMeta);
		assert.equal(parsed.id, wslTaskId);
		assert.equal(parsed.slug, "Add a WSL limiter");
		assert.equal(parsed.projectDir, "/home/me/kilo-wsl-app");
		assert.equal(parsed.projectName, "kilo-wsl-app");
		assert.equal(parsed.messages.length, 2);
		assert.equal(parsed.messages[0]?.content, "Add a WSL limiter");
		assert.equal(parsed.messages[1]?.content, "WSL limiter added.");
		assert.equal(parsed.messages[1]?.hasToolUse, true);
		assert.equal(parsed.messages[0]?.timestamp, new Date(1793000000000).toISOString());

		// The watcher must stay on local Windows paths only.
		const paths = (kiloAdapter.watchPaths?.() ?? []).map(normalizePath);
		assert.equal(paths.length, 2);
		assert.ok(paths.every((entry) => !entry.includes("wsl-home")));
	} finally {
		setWslHomesForTesting(null);
	}
});
