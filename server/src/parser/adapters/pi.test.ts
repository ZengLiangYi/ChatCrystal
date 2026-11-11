import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

const fixtureRoot = mkdtempSync(join(tmpdir(), "cc-pi-"));
const piDataDir = join(fixtureRoot, "agent");
const customDir = join(fixtureRoot, "custom-sessions");
const wslHome = join(fixtureRoot, "wsl-home");
const wslAgentDir = join(wslHome, ".pi", "agent");

// appConfig freezes when config.ts is first imported: point Pi's data dir at
// the fixture and keep this machine's real WSL distros out of it *before*
// importing the adapter. The WSL test injects its own home.
process.env.PI_CODING_AGENT_DIR = piDataDir;
process.env.PI_CODING_AGENT_SESSION_DIR = "";
process.env.CHATCRYSTAL_WSL = "0";

const { piAdapter } = await import("./pi.js");
const { setWslHomesForTesting } = await import("../wsl.js");

after(() => {
	setWslHomesForTesting(null);
	rmSync(fixtureRoot, { recursive: true, force: true });
});

/** Write `<base>/<projectFolder>/<stem>.jsonl`; a "" project folder is flat. */
function writeTranscript(
	baseDir: string,
	projectFolder: string,
	fileStem: string,
	lines: Array<Record<string, unknown> | string>,
): string {
	const filePath = projectFolder
		? join(baseDir, projectFolder, `${fileStem}.jsonl`)
		: join(baseDir, `${fileStem}.jsonl`);
	mkdirSync(dirname(filePath), { recursive: true });
	const body = `${lines
		.map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
		.join("\n")}\n`;
	writeFileSync(filePath, body, "utf-8");
	return filePath;
}

/** `--home-me-code--`: the encoded cwd folder Pi stores one-off sessions in. */
const FALLBACK_FOLDER = "--home-me-code--";

const MAIN_LINES: Array<Record<string, unknown> | string> = [
	{
		type: "session",
		version: 3,
		id: "session-main",
		timestamp: "2026-09-24T08:00:00.000Z",
		cwd: "/work/pi",
	},
	{
		type: "model_change",
		id: "m1",
		timestamp: "2026-09-24T08:00:00.100Z",
		provider: "anthropic",
		modelId: "claude-opus-5-5",
	},
	{
		type: "thinking_level_change",
		id: "m2",
		timestamp: "2026-09-24T08:00:00.100Z",
		thinkingLevel: "high",
	},
	{
		type: "message",
		id: "sys1",
		parentId: "m2",
		timestamp: "2026-09-24T08:00:00.500Z",
		message: { role: "system", content: "You are a coding assistant." },
	},
	{
		type: "message",
		id: "u1",
		parentId: null,
		timestamp: "2026-09-24T08:00:01.000Z",
		message: { role: "user", content: [{ type: "text", text: "Refactor the parser" }] },
	},
	{
		type: "message",
		id: "a2",
		parentId: "u1",
		timestamp: "2026-09-24T08:00:05.000Z",
		message: {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "Let me think" },
				{ type: "text", text: "Here is the plan:\n```ts\nconst x = 1;\n```" },
				{
					type: "toolCall",
					id: "call-1",
					name: "read",
					arguments: { path: "/work/pi/src/main.ts" },
				},
			],
			model: "claude-opus-5-5",
		},
	},
	{
		type: "message",
		id: "t1",
		parentId: "a2",
		timestamp: "2026-09-24T08:00:05.500Z",
		message: {
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "read",
			content: [{ type: "text", text: "file contents" }],
		},
	},
	{
		type: "message",
		id: "a3",
		parentId: "t1",
		timestamp: "2026-09-24T08:00:07.000Z",
		message: { role: "assistant", content: [{ type: "text", text: "Running the task." }] },
	},
	{
		type: "message",
		id: "t2",
		parentId: "a3",
		timestamp: "2026-09-24T08:00:07.500Z",
		message: {
			role: "toolResult",
			toolCallId: "call-2",
			toolName: "task",
			content: [{ type: "text", text: "done" }],
			nestedCalls: { calls: [{ name: "bash" }] },
		},
	},
	// A user record carrying only a tool result is not a prompt.
	{
		type: "message",
		id: "noise1",
		parentId: "t2",
		timestamp: "2026-09-24T08:00:08.000Z",
		message: { role: "user", content: [{ type: "toolResult", toolCallId: "call-3" }] },
	},
	{
		type: "usage",
		id: "us1",
		parentId: "noise1",
		timestamp: "2026-09-24T08:00:09.000Z",
		kind: "cache_warm",
		usage: { input: 0, output: 0, cacheRead: 300, cacheWrite: 0 },
	},
	{
		type: "compaction",
		id: "cp1",
		parentId: "us1",
		timestamp: "2026-09-24T08:00:10.000Z",
		summary: "The parser was split up.",
		tokensBefore: 2000,
	},
	{
		type: "branch_summary",
		id: "bs1",
		parentId: "cp1",
		timestamp: "2026-09-24T08:00:11.000Z",
		summary: "Branch",
	},
	{
		type: "session_info",
		id: "si1",
		parentId: "bs1",
		timestamp: "2026-09-24T08:00:12.000Z",
		name: "Parser refactor",
	},
];

const SORT_LINES: Array<Record<string, unknown> | string> = [
	{
		type: "session",
		version: 3,
		id: "session-sort",
		timestamp: "2026-09-26T10:00:00.000Z",
		cwd: "/work/sort",
	},
	{
		type: "message",
		id: "s-second",
		timestamp: "2026-09-26T10:00:09.000Z",
		message: { role: "assistant", content: "second" },
	},
	"{not valid json",
	{
		type: "message",
		id: "s-first",
		timestamp: "2026-09-26T10:00:03.000Z",
		message: { role: "user", content: "first" },
	},
	{
		type: "message",
		id: "s-middle",
		timestamp: "2026-09-26T10:00:06.000Z",
		message: { role: "assistant", content: "middle" },
	},
];

const FALLBACK_LINES: Array<Record<string, unknown> | string> = [
	// No session header: the encoded cwd folder and the file mtime fill in.
	{ type: "message", id: "f1", message: { role: "user", content: "Where am I?" } },
	{ type: "model_change", id: "f2", modelId: "claude-opus-5-5" },
	{
		type: "message",
		id: "f3",
		timestamp: 1_990_000_000_000,
		message: { role: "assistant", content: [{ type: "text", text: "Fallback" }] },
	},
];

const CUSTOM_LINES: Array<Record<string, unknown> | string> = [
	{
		type: "session",
		version: 3,
		id: "session-custom",
		timestamp: "2026-09-25T09:00:00.000Z",
		cwd: "/work/custom",
	},
	{
		type: "message",
		id: "c1",
		timestamp: "2026-09-25T09:00:01.000Z",
		message: { role: "user", content: "flat session" },
	},
	{
		type: "message",
		id: "c2",
		timestamp: "2026-09-25T09:00:02.000Z",
		message: { role: "assistant", content: [{ type: "text", text: "flat answer" }] },
	},
	{
		type: "session_info",
		id: "c3",
		timestamp: "2026-09-25T09:00:03.000Z",
		name: "Flat session",
	},
];

const WSL_LINES: Array<Record<string, unknown> | string> = [
	{
		type: "session",
		version: 3,
		id: "session-wsl",
		timestamp: "2026-09-28T08:00:00.000Z",
		cwd: "/home/me/wsl-pi",
	},
	{
		type: "message",
		id: "w1",
		timestamp: "2026-09-28T08:00:01.000Z",
		message: { role: "user", content: [{ type: "text", text: "from wsl" }] },
	},
	{
		type: "message",
		id: "w2",
		timestamp: "2026-09-28T08:00:02.000Z",
		message: { role: "assistant", content: [{ type: "text", text: "wsl answer" }] },
	},
	{
		type: "session_info",
		id: "w3",
		timestamp: "2026-09-28T08:00:03.000Z",
		name: "WSL session",
	},
];

test("detect is null without sessions, then counts the default and configured folders", async () => {
	assert.equal(await piAdapter.detect(), null);

	writeTranscript(
		join(piDataDir, "sessions"),
		"--work-pi--",
		"2026-09-24T08-00-00-000Z_session-main",
		MAIN_LINES,
	);
	writeTranscript(
		customDir,
		"",
		"2026-09-25T09-00-00-000Z_session-custom",
		CUSTOM_LINES,
	);
	// Pi's own way of pointing the session store at one folder.
	writeFileSync(
		join(piDataDir, "settings.json"),
		JSON.stringify({ sessionDir: customDir }),
		"utf-8",
	);
	writeTranscript(
		join(piDataDir, "sessions"),
		"--sort-order--",
		"2026-09-26T10-00-00-000Z_session-sort",
		SORT_LINES,
	);
	writeTranscript(
		join(piDataDir, "sessions"),
		FALLBACK_FOLDER,
		"2026-09-27T11-00-00-000Z_session-fallback",
		FALLBACK_LINES,
	);

	const info = await piAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "pi");
	assert.equal(info.displayName, "Pi");
	assert.equal(info.dataDir, piDataDir);
	assert.equal(info.conversationCount, 4);

	const metas = await piAdapter.scan();
	assert.deepEqual(
		metas.map((meta) => meta.id).sort(),
		["session-custom", "session-fallback", "session-main", "session-sort"],
	);
	for (const meta of metas) assert.equal(meta.source, "pi");

	const main = metas.find((meta) => meta.id === "session-main");
	assert.ok(main);
	assert.equal(main.rootDir, piDataDir);
	assert.equal(main.projectDir, "--work-pi--");
	assert.equal(
		main.filePath,
		join(
			piDataDir,
			"sessions",
			"--work-pi--",
			"2026-09-24T08-00-00-000Z_session-main.jsonl",
		),
	);
	assert.ok(main.fileSize > 0);
	assert.match(main.fileMtime, /^\d{4}-\d{2}-\d{2}T/);

	const custom = metas.find((meta) => meta.id === "session-custom");
	assert.ok(custom);
	assert.equal(custom.rootDir, customDir);
	assert.equal(custom.projectDir, "");

	// The watcher only gets local paths.
	const watchPaths = piAdapter.watchPaths?.() ?? [];
	assert.equal(watchPaths.length, 2);
	assert.ok(watchPaths.some((target) => target.startsWith(piDataDir)));
	assert.ok(watchPaths.some((target) => target.startsWith(customDir)));
});

test("parse keeps user and assistant turns and flags tools, code and thinking", async () => {
	const metas = await piAdapter.scan();
	const main = metas.find((meta) => meta.id === "session-main");
	assert.ok(main);

	const parsed = await piAdapter.parse(main);
	assert.equal(parsed.id, "session-main");
	assert.equal(parsed.source, "pi");
	assert.equal(parsed.slug, "Parser refactor");
	assert.equal(parsed.cwd, "/work/pi");
	assert.equal(parsed.projectDir, "/work/pi");
	assert.equal(parsed.projectName, "pi");
	assert.equal(parsed.messages.length, 3);

	const [user, reply, nested] = parsed.messages;
	assert.equal(user.type, "user");
	assert.equal(user.role, "user");
	assert.equal(user.content, "Refactor the parser");
	assert.equal(user.hasToolUse, false);
	assert.equal(user.hasCode, false);
	assert.equal(user.thinking, null);
	assert.equal(user.id, "u1");
	assert.equal(user.parentUuid, null);
	assert.equal(user.timestamp, "2026-09-24T08:00:01.000Z");

	assert.equal(reply.type, "assistant");
	assert.equal(reply.role, "assistant");
	assert.equal(reply.content, "Here is the plan:\n```ts\nconst x = 1;\n```");
	assert.equal(reply.hasToolUse, true);
	assert.equal(reply.hasCode, true);
	assert.equal(reply.thinking, "Let me think");
	assert.equal(reply.parentUuid, "u1");
	assert.equal(reply.timestamp, "2026-09-24T08:00:05.000Z");

	// A tool result that ran tools in turn marks its assistant as tool-using.
	assert.equal(nested.type, "assistant");
	assert.equal(nested.content, "Running the task.");
	assert.equal(nested.hasToolUse, true);
	assert.equal(nested.hasCode, false);

	assert.equal(parsed.firstMessageAt, "2026-09-24T08:00:01.000Z");
	assert.equal(parsed.lastMessageAt, "2026-09-24T08:00:07.000Z");
});

test("parse orders messages by timestamp", async () => {
	const metas = await piAdapter.scan();
	const sortMeta = metas.find((meta) => meta.id === "session-sort");
	assert.ok(sortMeta);

	const parsed = await piAdapter.parse(sortMeta);
	assert.deepEqual(
		parsed.messages.map((message) => message.content),
		["first", "middle", "second"],
	);
	assert.deepEqual(
		parsed.messages.map((message) => message.timestamp),
		[
			"2026-09-26T10:00:03.000Z",
			"2026-09-26T10:00:06.000Z",
			"2026-09-26T10:00:09.000Z",
		],
	);
});

test("parse falls back to the cwd folder and file mtime without a header", async () => {
	const metas = await piAdapter.scan();
	const fallbackMeta = metas.find((meta) => meta.id === "session-fallback");
	assert.ok(fallbackMeta);

	const parsed = await piAdapter.parse(fallbackMeta);
	assert.equal(parsed.slug, null);
	assert.equal(parsed.cwd, null);
	assert.equal(parsed.projectDir, "/home/me/code");
	assert.equal(parsed.projectName, "code");
	assert.equal(parsed.messages.length, 2);
	assert.equal(parsed.messages[0].content, "Where am I?");
	// No timestamp in the record: the file's mtime is used.
	assert.equal(parsed.messages[0].timestamp, fallbackMeta.fileMtime);
	assert.equal(parsed.messages[1].content, "Fallback");
	// Epoch milliseconds in the record are understood.
	assert.equal(
		parsed.messages[1].timestamp,
		new Date(1_990_000_000_000).toISOString(),
	);
	assert.equal(parsed.firstMessageAt, fallbackMeta.fileMtime);
	assert.equal(
		parsed.lastMessageAt,
		new Date(1_990_000_000_000).toISOString(),
	);
});

test("parse reads a session from Pi's configured single session folder", async () => {
	const metas = await piAdapter.scan();
	const customMeta = metas.find((meta) => meta.id === "session-custom");
	assert.ok(customMeta);

	const parsed = await piAdapter.parse(customMeta);
	assert.equal(parsed.cwd, "/work/custom");
	assert.equal(parsed.projectDir, "/work/custom");
	assert.equal(parsed.projectName, "custom");
	assert.equal(parsed.slug, "Flat session");
	assert.equal(parsed.messages.length, 2);
	assert.deepEqual(
		parsed.messages.map((message) => message.type),
		["user", "assistant"],
	);
});

test("WSL distro home sessions are detected, tagged with rootDir and parsed", async () => {
	writeTranscript(
		join(wslAgentDir, "sessions"),
		"--wsl-pi--",
		"2026-09-28T08-00-00-000Z_session-wsl",
		WSL_LINES,
	);
	setWslHomesForTesting([wslHome]);
	try {
		const info = await piAdapter.detect();
		assert.ok(info);
		assert.equal(info.dataDir, piDataDir);
		assert.equal(info.conversationCount, 5);

		const metas = await piAdapter.scan();
		const wslMeta = metas.find((meta) => meta.id === "session-wsl");
		assert.ok(wslMeta);
		assert.equal(wslMeta.rootDir, wslAgentDir);
		assert.match(wslMeta.filePath, /wsl-home/);

		const parsed = await piAdapter.parse(wslMeta);
		assert.equal(parsed.cwd, "/home/me/wsl-pi");
		assert.equal(parsed.slug, "WSL session");
		assert.equal(parsed.messages.length, 2);
		assert.equal(parsed.messages[0].content, "from wsl");

		// watchPaths never returns the injected WSL root.
		for (const target of piAdapter.watchPaths?.() ?? []) {
			assert.doesNotMatch(target, /wsl/i);
		}
	} finally {
		setWslHomesForTesting(null);
	}
});
