import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

// ---------------------------------------------------------------------------
// Self-contained fixture: both Cline stores live under one temp root and the
// data-dir env vars must be set before the adapter (and appConfig) is imported.
// ---------------------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), "chatcrystal-cline-test-"));
const cliDir = join(root, "cline-cli");
const extDir = join(root, "cline-ext");

process.env.DATA_DIR = join(root, "data");
process.env.CLINE_DATA_DIR = cliDir;
process.env.CLINE_EXT_DATA_DIR = extDir;
// A real WSL distro may be running on this machine; keep it out of the tests.
process.env.CHATCRYSTAL_WSL = "0";

const { clineAdapter } = await import("./cline.js");
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

function assertIsoTimestamp(value: string): void {
	assert.equal(new Date(value).toISOString(), value);
}

const CLI_SESSION_ID = "1790503200000_ab12c";
const CLI_ARRAY_SESSION_ID = "1790600000000_cd99e";
const CLI_BROKEN_SESSION_ID = "1790700000000_bad00";
const EXT_TASK_ID = "ext-task-1";
const EXT_BROKEN_TASK_ID = "ext-task-broken";
const CLI_TITLE = "Importer speed-up";
const EXT_BASE_MS = 1790000000000;

let fixturesReady = false;

function ensureFixtures(): void {
	if (fixturesReady) return;
	fixturesReady = true;
	createCliFixtures();
	createExtensionFixtures();
}

function createCliFixtures(): void {
	const sessionsDir = join(cliDir, "data", "sessions");

	// Modern CLI session: manifest + `{ messages: [...] }` transcript with
	// per-message `ts` and `<mode_notice>` / `<user_input>` prompt envelopes.
	const sessionDir = join(sessionsDir, CLI_SESSION_ID);
	writeJson(join(sessionDir, `${CLI_SESSION_ID}.json`), {
		version: 1,
		session_id: CLI_SESSION_ID,
		source: "cli",
		started_at: "2026-09-27T10:00:00.000Z",
		status: "completed",
		cwd: "/work/cline-app",
		workspace_root: "/work/cline-app",
		prompt: '<user_input mode="act">Speed up the importer</user_input>',
		metadata: { title: CLI_TITLE },
	});
	writeJson(join(sessionDir, `${CLI_SESSION_ID}.messages.json`), {
		version: 1,
		updated_at: "2026-09-27T10:02:00.000Z",
		agent: "lead",
		sessionId: CLI_SESSION_ID,
		messages: [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: '<mode_notice>Act mode</mode_notice>\n<user_input mode="act">Speed up the importer</user_input>',
					},
				],
				ts: 1790503200000,
			},
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I'll profile the importer first." },
					{
						type: "tool_use",
						id: "tool-1",
						name: "read_files",
						input: { path: "src/importer.ts" },
					},
				],
				ts: 1790503210000,
				modelInfo: { id: "claude-opus-5-5", provider: "anthropic" },
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ok" }],
				ts: 1790503211000,
			},
			// Corrupt entry between valid turns must be skipped, not fail the file.
			"not-a-message",
			{
				role: "assistant",
				content: "Importer is 2x faster now.",
				ts: 1790503320000,
			},
		],
	});

	// Alternate CLI shape: a plain top-level array and no manifest beside it.
	writeJson(join(sessionsDir, CLI_ARRAY_SESSION_ID, `${CLI_ARRAY_SESSION_ID}.messages.json`), [
		{ role: "user", content: [{ type: "text", text: "Add regression tests" }] },
		{ role: "assistant", content: [{ type: "text", text: "On it." }] },
	]);

	// Truncated transcript: scan lists it, parse must return zero messages.
	mkdirSync(join(sessionsDir, CLI_BROKEN_SESSION_ID), { recursive: true });
	writeFileSync(
		join(sessionsDir, CLI_BROKEN_SESSION_ID, `${CLI_BROKEN_SESSION_ID}.messages.json`),
		'{"messages": [',
		"utf-8",
	);
	writeJson(join(sessionsDir, CLI_BROKEN_SESSION_ID, `${CLI_BROKEN_SESSION_ID}.json`), {
		session_id: CLI_BROKEN_SESSION_ID,
		cwd: "/work/broken-app",
		started_at: "2026-09-28T09:00:00.000Z",
	});
}

function createExtensionFixtures(): void {
	const tasksDir = join(extDir, "tasks");

	writeJson(join(tasksDir, EXT_TASK_ID, "api_conversation_history.json"), [
		{
			role: "user",
			content: [{ type: "text", text: "<task>\nRefactor the parser\n</task>" }],
		},
		{
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "The parser is large." },
				{ type: "text", text: "I'll inspect the parser first." },
				{
					type: "tool_use",
					id: "tool-1",
					name: "read_file",
					input: { path: "src/parser.ts" },
				},
			],
		},
		{
			role: "user",
			content: [{ type: "tool_result", tool_use_id: "tool-1", content: "..." }],
		},
		{ role: "assistant", content: "The parser now has a shared helper." },
	]);
	writeJson(join(tasksDir, EXT_TASK_ID, "history_item.json"), {
		id: EXT_TASK_ID,
		ts: EXT_BASE_MS,
		task: "<task>Refactor the parser</task>",
		workspace: "/work/refactor-me",
	});

	// Cline's extension keeps history in one `state/taskHistory.json` array.
	writeJson(join(extDir, "state", "taskHistory.json"), [
		{
			id: EXT_TASK_ID,
			ts: EXT_BASE_MS,
			task: "<task>Refactor the parser</task>",
			workspace: "/work/refactor-me",
		},
		{
			id: EXT_BROKEN_TASK_ID,
			ts: 1790100000000,
			task: "Broken task",
			workspace: "/work/broken-task",
		},
	]);

	// Corrupt transcript entry for an otherwise valid task.
	mkdirSync(join(tasksDir, EXT_BROKEN_TASK_ID), { recursive: true });
	writeFileSync(
		join(tasksDir, EXT_BROKEN_TASK_ID, "api_conversation_history.json"),
		"{not json",
		"utf-8",
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("detect returns null when neither Cline store has data", async () => {
	assert.equal(await clineAdapter.detect(), null);
	assert.deepEqual(clineAdapter.watchPaths?.() ?? [], []);
});

test("detect counts CLI sessions and VS Code extension tasks together", async () => {
	ensureFixtures();
	const info = await clineAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "cline");
	assert.equal(info.displayName, "Cline");
	assert.equal(info.dataDir, cliDir);
	assert.equal(info.conversationCount, 5);
});

test("scan reports id, source and projectDir for both generations", async () => {
	ensureFixtures();
	const metas = await clineAdapter.scan();
	assert.equal(metas.length, 5);

	const cli = metas.find((meta) => meta.id === CLI_SESSION_ID);
	assert.ok(cli);
	assert.equal(cli.source, "cline");
	assert.equal(cli.projectDir, "/work/cline-app");
	assert.ok(normalizePath(cli.filePath).endsWith(`${CLI_SESSION_ID}.messages.json`));

	const ext = metas.find((meta) => meta.id === EXT_TASK_ID);
	assert.ok(ext);
	assert.equal(ext.source, "cline");
	assert.equal(ext.projectDir, "/work/refactor-me");
	assert.ok(normalizePath(ext.filePath).endsWith("tasks/ext-task-1/api_conversation_history.json"));

	const broken = metas.find((meta) => meta.id === EXT_BROKEN_TASK_ID);
	assert.ok(broken);
	assert.equal(broken.projectDir, "/work/broken-task");
});

test("parse CLI session unwraps prompt envelopes and keeps message timing", async () => {
	ensureFixtures();
	const metas = await clineAdapter.scan();
	const meta = metas.find((item) => item.id === CLI_SESSION_ID);
	assert.ok(meta);

	const parsed = await clineAdapter.parse(meta);
	assert.equal(parsed.id, CLI_SESSION_ID);
	assert.equal(parsed.source, "cline");
	assert.equal(parsed.slug, CLI_TITLE);
	assert.equal(parsed.projectDir, "/work/cline-app");
	assert.equal(parsed.projectName, "cline-app");
	assert.equal(parsed.cwd, "/work/cline-app");

	// The `<mode_notice>` and `<user_input>` wrappers are stripped on user turns.
	assert.equal(parsed.messages.length, 3);
	assert.deepEqual(
		parsed.messages.map((message) => [message.type, message.role]),
		[
			["user", "user"],
			["assistant", "assistant"],
			["assistant", "assistant"],
		],
	);
	assert.equal(parsed.messages[0]?.content, "Speed up the importer");
	assert.equal(parsed.messages[1]?.content, "I'll profile the importer first.");
	assert.equal(parsed.messages[1]?.hasToolUse, true);
	assert.equal(parsed.messages[2]?.content, "Importer is 2x faster now.");
	assert.equal(parsed.messages[2]?.hasToolUse, false);

	assert.equal(parsed.messages[0]?.timestamp, "2026-09-27T10:00:00.000Z");
	assert.equal(parsed.messages[1]?.timestamp, "2026-09-27T10:00:10.000Z");
	assert.equal(parsed.messages[2]?.timestamp, "2026-09-27T10:02:00.000Z");
	for (const message of parsed.messages) assertIsoTimestamp(message.timestamp);
	assert.equal(parsed.firstMessageAt, "2026-09-27T10:00:00.000Z");
	assert.equal(parsed.lastMessageAt, "2026-09-27T10:02:00.000Z");
});

test("parse CLI session supports a plain array transcript without a manifest", async () => {
	ensureFixtures();
	const metas = await clineAdapter.scan();
	const meta = metas.find((item) => item.id === CLI_ARRAY_SESSION_ID);
	assert.ok(meta);

	const parsed = await clineAdapter.parse(meta);
	assert.equal(parsed.slug, "Add regression tests");
	assert.equal(parsed.projectDir, "");
	assert.equal(parsed.projectName, "Unknown");
	assert.equal(parsed.messages.length, 2);

	// No manifest and no per-message ts: the file mtime is the base time.
	const baseMs = Date.parse(meta.fileMtime);
	assert.equal(parsed.messages[0]?.timestamp, new Date(baseMs).toISOString());
	assert.equal(parsed.messages[1]?.timestamp, new Date(baseMs + 1000).toISOString());
});

test("parse extension task unwraps <task>, keeps thinking and tool-use flags", async () => {
	ensureFixtures();
	const metas = await clineAdapter.scan();
	const meta = metas.find((item) => item.id === EXT_TASK_ID);
	assert.ok(meta);

	const parsed = await clineAdapter.parse(meta);
	assert.equal(parsed.id, EXT_TASK_ID);
	assert.equal(parsed.source, "cline");
	assert.equal(parsed.slug, "Refactor the parser");
	assert.equal(parsed.projectDir, "/work/refactor-me");
	assert.equal(parsed.projectName, "refactor-me");

	assert.equal(parsed.messages.length, 3);
	assert.equal(parsed.messages[0]?.type, "user");
	assert.equal(parsed.messages[0]?.content, "Refactor the parser");
	assert.equal(parsed.messages[1]?.type, "assistant");
	assert.equal(parsed.messages[1]?.content, "I'll inspect the parser first.");
	assert.equal(parsed.messages[1]?.hasToolUse, true);
	assert.equal(parsed.messages[1]?.thinking, "The parser is large.");
	assert.equal(parsed.messages[2]?.content, "The parser now has a shared helper.");

	const baseIso = new Date(EXT_BASE_MS).toISOString();
	assert.equal(parsed.messages[0]?.timestamp, baseIso);
	assert.equal(parsed.messages[1]?.timestamp, new Date(EXT_BASE_MS + 1000).toISOString());
	assert.equal(parsed.messages[2]?.timestamp, new Date(EXT_BASE_MS + 2000).toISOString());
	for (const message of parsed.messages) assertIsoTimestamp(message.timestamp);
});

test("parse tolerates corrupt transcripts in both stores", async () => {
	ensureFixtures();
	const metas = await clineAdapter.scan();

	const brokenCliMeta = metas.find((item) => item.id === CLI_BROKEN_SESSION_ID);
	assert.ok(brokenCliMeta);
	const brokenCli = await clineAdapter.parse(brokenCliMeta);
	assert.deepEqual(brokenCli.messages, []);
	assert.equal(brokenCli.projectDir, "/work/broken-app");
	assert.equal(brokenCli.projectName, "broken-app");
	assert.equal(brokenCli.slug, null);

	const brokenExtMeta = metas.find((item) => item.id === EXT_BROKEN_TASK_ID);
	assert.ok(brokenExtMeta);
	const brokenExt = await clineAdapter.parse(brokenExtMeta);
	assert.deepEqual(brokenExt.messages, []);
	assert.equal(brokenExt.projectDir, "/work/broken-task");
	assert.equal(brokenExt.projectName, "broken-task");
	assert.equal(brokenExt.slug, "Broken task");
});

test("watchPaths covers CLI sessions and both extension stores", () => {
	ensureFixtures();
	const paths = (clineAdapter.watchPaths?.() ?? []).map(normalizePath);
	assert.equal(paths.length, 3);
	assert.ok(paths[0]?.endsWith("cline-cli/data/sessions/**/*"));
	assert.ok(paths.some((item) => item.endsWith("tasks/**/api_conversation_history.json")));
	assert.ok(paths.some((item) => item.endsWith("state/taskHistory.json")));
});

const WSL_CLI_SESSION_ID = "1790800000000_wsl01";
const WSL_EXT_TASK_ID = "wsl-ext-task-1";
const WSL_EXT_BASE_MS = 1794000000000;

test("WSL distro sessions and extension tasks are scanned from their own roots", async () => {
	ensureFixtures();
	const wslHome = join(root, "wsl-home");
	const wslCliRoot = join(wslHome, ".cline");
	const wslCliSessionsDir = join(wslCliRoot, "data", "sessions");
	const wslExtRoot = join(
		wslHome,
		".vscode-server",
		"data",
		"User",
		"globalStorage",
		"saoudrizwan.claude-dev",
	);

	// Modern CLI store inside the WSL distro home.
	const wslCliSessionDir = join(wslCliSessionsDir, WSL_CLI_SESSION_ID);
	writeJson(join(wslCliSessionDir, `${WSL_CLI_SESSION_ID}.json`), {
		session_id: WSL_CLI_SESSION_ID,
		started_at: "2026-10-02T10:00:00.000Z",
		cwd: "/home/me/wsl-cli-app",
		metadata: { title: "WSL CLI session" },
	});
	writeJson(join(wslCliSessionDir, `${WSL_CLI_SESSION_ID}.messages.json`), {
		sessionId: WSL_CLI_SESSION_ID,
		messages: [
			{
				role: "user",
				content: [{ type: "text", text: "Speed up WSL imports" }],
				ts: WSL_EXT_BASE_MS,
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "WSL importer is faster." }],
				ts: WSL_EXT_BASE_MS + 10000,
			},
		],
	});

	// VS Code Remote extension store inside the WSL distro home. Cline's legacy
	// extension keeps task metadata in the store's own state/taskHistory.json.
	const wslExtTaskDir = join(wslExtRoot, "tasks", WSL_EXT_TASK_ID);
	writeJson(join(wslExtTaskDir, "api_conversation_history.json"), [
		{
			role: "user",
			content: [{ type: "text", text: "<task>Refactor the WSL parser</task>" }],
		},
		{
			role: "assistant",
			content: [{ type: "text", text: "WSL parser refactored." }],
		},
	]);
	writeJson(join(wslExtRoot, "state", "taskHistory.json"), [
		{
			id: WSL_EXT_TASK_ID,
			ts: WSL_EXT_BASE_MS,
			task: "<task>Refactor the WSL parser</task>",
			workspace: "/home/me/wsl-ext-app",
		},
	]);

	setWslHomesForTesting([wslHome]);
	try {
		const info = await clineAdapter.detect();
		assert.ok(info);
		// Five local conversations + one WSL CLI session + one WSL extension task.
		assert.equal(info.conversationCount, 7);
		// detect still reports the primary Windows CLI root.
		assert.equal(info.dataDir, cliDir);

		const metas = await clineAdapter.scan();
		assert.equal(metas.length, 7);

		const wslCliMeta = metas.find((meta) => meta.id === WSL_CLI_SESSION_ID);
		assert.ok(wslCliMeta);
		assert.equal(wslCliMeta.source, "cline");
		assert.equal(wslCliMeta.rootDir, wslCliRoot);
		assert.equal(wslCliMeta.projectDir, "/home/me/wsl-cli-app");
		assert.ok(
			normalizePath(wslCliMeta.filePath).endsWith(
				`${WSL_CLI_SESSION_ID}/${WSL_CLI_SESSION_ID}.messages.json`,
			),
		);

		const wslCliParsed = await clineAdapter.parse(wslCliMeta);
		assert.equal(wslCliParsed.id, WSL_CLI_SESSION_ID);
		assert.equal(wslCliParsed.slug, "WSL CLI session");
		assert.equal(wslCliParsed.projectDir, "/home/me/wsl-cli-app");
		assert.equal(wslCliParsed.messages.length, 2);
		assert.equal(wslCliParsed.messages[0]?.content, "Speed up WSL imports");
		assert.equal(wslCliParsed.messages[1]?.content, "WSL importer is faster.");

		const wslExtMeta = metas.find((meta) => meta.id === WSL_EXT_TASK_ID);
		assert.ok(wslExtMeta);
		assert.equal(wslExtMeta.rootDir, wslExtRoot);
		assert.equal(wslExtMeta.projectDir, "/home/me/wsl-ext-app");
		assert.ok(
			normalizePath(wslExtMeta.filePath).includes("wsl-home/.vscode-server"),
		);

		const wslExtParsed = await clineAdapter.parse(wslExtMeta);
		assert.equal(wslExtParsed.id, WSL_EXT_TASK_ID);
		// Title/workspace come from the WSL root's state/taskHistory.json.
		assert.equal(wslExtParsed.slug, "Refactor the WSL parser");
		assert.equal(wslExtParsed.projectDir, "/home/me/wsl-ext-app");
		assert.equal(wslExtParsed.projectName, "wsl-ext-app");
		assert.equal(wslExtParsed.messages.length, 2);
		assert.equal(wslExtParsed.messages[0]?.content, "Refactor the WSL parser");
		assert.equal(wslExtParsed.messages[1]?.content, "WSL parser refactored.");

		// The watcher stays on local Windows paths only (no UNC paths).
		const paths = (clineAdapter.watchPaths?.() ?? []).map(normalizePath);
		assert.equal(paths.length, 3);
		assert.ok(paths.every((entry) => !entry.includes("wsl-home")));
	} finally {
		setWslHomesForTesting(null);
	}
});
