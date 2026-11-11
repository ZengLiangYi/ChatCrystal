import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

const fixtureRoot = mkdtempSync(join(tmpdir(), "cc-cindy-"));
const cindyDataDir = join(fixtureRoot, "config");
const wslHome = join(fixtureRoot, "wsl-home");
const wslConfigDir = join(wslHome, ".config");

// appConfig freezes when config.ts is first imported: point Cindy's config
// folder at the fixture and keep this machine's real WSL distros out of it
// *before* importing the adapter. The WSL test injects its own home.
process.env.CINDY_CONFIG_DIR = cindyDataDir;
process.env.CHATCRYSTAL_WSL = "0";

const { cindyAdapter } = await import("./cindy.js");
const { setWslHomesForTesting } = await import("../wsl.js");

after(() => {
	setWslHomesForTesting(null);
	rmSync(fixtureRoot, { recursive: true, force: true });
});

/** Write a flat `<base>/<stem>.jsonl` session file. */
function writeTranscript(
	baseDir: string,
	fileStem: string,
	lines: Array<Record<string, unknown> | string>,
): string {
	const filePath = join(baseDir, `${fileStem}.jsonl`);
	mkdirSync(dirname(filePath), { recursive: true });
	const body = `${lines
		.map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
		.join("\n")}\n`;
	writeFileSync(filePath, body, "utf-8");
	return filePath;
}

const LOCAL_LINES: Array<Record<string, unknown> | string> = [
	{
		type: "session",
		version: 3,
		id: "cindy-local-session",
		timestamp: "2026-09-24T08:00:00.000Z",
		cwd: "/work/cindy",
	},
	{
		type: "message",
		id: "l1",
		timestamp: "2026-09-24T08:00:01.000Z",
		message: { role: "user", content: [{ type: "text", text: "Cindy question" }] },
	},
	{
		type: "message",
		id: "l2",
		timestamp: "2026-09-24T08:00:02.000Z",
		message: {
			role: "assistant",
			content: [
				{ type: "text", text: "Cindy answer" },
				{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } },
			],
		},
	},
	{
		type: "session_info",
		id: "l3",
		timestamp: "2026-09-24T08:00:03.000Z",
		name: "Cindy session",
	},
];

const GLOBAL_LINES: Array<Record<string, unknown> | string> = [
	{
		type: "session",
		version: 3,
		id: "cindy-global-session",
		timestamp: "2026-09-24T09:00:00.000Z",
		cwd: "/work/cindy-global",
	},
	{
		type: "message",
		id: "g1",
		timestamp: "2026-09-24T09:00:01.000Z",
		message: { role: "user", content: "global question" },
	},
	{
		type: "message",
		id: "g2",
		timestamp: "2026-09-24T09:00:02.000Z",
		message: { role: "assistant", content: [{ type: "text", text: "global answer" }] },
	},
];

const WSL_LINES: Array<Record<string, unknown> | string> = [
	{
		type: "session",
		version: 3,
		id: "cindy-wsl-session",
		timestamp: "2026-09-25T08:00:00.000Z",
		cwd: "/home/me/wsl-cindy",
	},
	{
		type: "message",
		id: "w1",
		timestamp: "2026-09-25T08:00:01.000Z",
		message: { role: "user", content: [{ type: "text", text: "from wsl cindy" }] },
	},
];

test("detect is null without sessions, then counts both Cindy data folders", async () => {
	assert.equal(await cindyAdapter.detect(), null);

	writeTranscript(
		join(cindyDataDir, "Cindy", "pi-agent-home", "sessions"),
		"2026-09-24T08-00-00-000Z_cindy-local-session",
		LOCAL_LINES,
	);
	writeTranscript(
		join(cindyDataDir, "CindyGlobal", "pi-agent-home", "sessions"),
		"2026-09-24T09-00-00-000Z_cindy-global-session",
		GLOBAL_LINES,
	);
	// Files without Pi's `<time>_<id>` name are not sessions.
	writeTranscript(
		join(cindyDataDir, "Cindy", "pi-agent-home", "sessions"),
		"not-a-session",
		[{ type: "message", message: { role: "user", content: "noise" } }],
	);

	const info = await cindyAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "cindy");
	assert.equal(info.displayName, "Cindy");
	assert.equal(info.dataDir, cindyDataDir);
	assert.equal(info.conversationCount, 2);

	const metas = await cindyAdapter.scan();
	assert.deepEqual(
		metas.map((meta) => meta.id).sort(),
		["cindy-global-session", "cindy-local-session"],
	);
	for (const meta of metas) {
		assert.equal(meta.source, "cindy");
		assert.equal(meta.rootDir, cindyDataDir);
		assert.equal(meta.projectDir, "");
	}
	const local = metas.find((meta) => meta.id === "cindy-local-session");
	assert.ok(local);
	assert.equal(
		local.filePath,
		join(
			cindyDataDir,
			"Cindy",
			"pi-agent-home",
			"sessions",
			"2026-09-24T08-00-00-000Z_cindy-local-session.jsonl",
		),
	);
	const global = metas.find((meta) => meta.id === "cindy-global-session");
	assert.ok(global);
	assert.match(global.filePath, /CindyGlobal/);

	// The watcher only gets local paths.
	const watchPaths = cindyAdapter.watchPaths?.() ?? [];
	assert.equal(watchPaths.length, 2);
	for (const target of watchPaths) {
		assert.ok(target.startsWith(cindyDataDir));
	}
});

test("parse reads Cindy's Pi-format sessions", async () => {
	const metas = await cindyAdapter.scan();
	const local = metas.find((meta) => meta.id === "cindy-local-session");
	assert.ok(local);

	const parsed = await cindyAdapter.parse(local);
	assert.equal(parsed.id, "cindy-local-session");
	assert.equal(parsed.source, "cindy");
	assert.equal(parsed.slug, "Cindy session");
	assert.equal(parsed.cwd, "/work/cindy");
	assert.equal(parsed.projectDir, "/work/cindy");
	assert.equal(parsed.projectName, "cindy");
	assert.equal(parsed.messages.length, 2);
	assert.equal(parsed.messages[0].type, "user");
	assert.equal(parsed.messages[0].content, "Cindy question");
	assert.equal(parsed.messages[1].type, "assistant");
	assert.equal(parsed.messages[1].content, "Cindy answer");
	assert.equal(parsed.messages[1].hasToolUse, true);
	assert.equal(parsed.firstMessageAt, "2026-09-24T08:00:01.000Z");
	assert.equal(parsed.lastMessageAt, "2026-09-24T08:00:02.000Z");
});

test("parse reads a session from Cindy's global build", async () => {
	const metas = await cindyAdapter.scan();
	const global = metas.find((meta) => meta.id === "cindy-global-session");
	assert.ok(global);

	const parsed = await cindyAdapter.parse(global);
	assert.equal(parsed.cwd, "/work/cindy-global");
	assert.deepEqual(
		parsed.messages.map((message) => message.content),
		["global question", "global answer"],
	);
});

test("WSL distro home sessions are detected, tagged with rootDir and parsed", async () => {
	writeTranscript(
		join(wslConfigDir, "Cindy", "pi-agent-home", "sessions"),
		"2026-09-25T08-00-00-000Z_cindy-wsl-session",
		WSL_LINES,
	);
	setWslHomesForTesting([wslHome]);
	try {
		const info = await cindyAdapter.detect();
		assert.ok(info);
		assert.equal(info.dataDir, cindyDataDir);
		assert.equal(info.conversationCount, 3);

		const metas = await cindyAdapter.scan();
		const wslMeta = metas.find((meta) => meta.id === "cindy-wsl-session");
		assert.ok(wslMeta);
		assert.equal(wslMeta.rootDir, wslConfigDir);
		assert.match(wslMeta.filePath, /wsl-home/);

		const parsed = await cindyAdapter.parse(wslMeta);
		assert.equal(parsed.cwd, "/home/me/wsl-cindy");
		assert.equal(parsed.messages[0].content, "from wsl cindy");

		// watchPaths never returns the injected WSL root.
		for (const target of cindyAdapter.watchPaths?.() ?? []) {
			assert.doesNotMatch(target, /wsl/i);
		}
	} finally {
		setWslHomesForTesting(null);
	}
});
