import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

const fixtureRoot = mkdtempSync(join(tmpdir(), "cc-raft-"));
const raftDataDir = join(fixtureRoot, "slock");
const wslHome = join(fixtureRoot, "wsl-home");
const wslRaftDir = join(wslHome, ".slock");

// appConfig freezes when config.ts is first imported: point Raft's folder at
// the fixture and keep this machine's real WSL distros out of it *before*
// importing the adapter. The WSL test injects its own home.
process.env.SLOCK_HOME = raftDataDir;
process.env.CHATCRYSTAL_WSL = "0";

const { raftAdapter } = await import("./raft.js");
const { setWslHomesForTesting } = await import("../wsl.js");

after(() => {
	setWslHomesForTesting(null);
	rmSync(fixtureRoot, { recursive: true, force: true });
});

/** Write `<base>/<folder>/<stem>.jsonl`, creating the folder. */
function writeTranscript(
	baseDir: string,
	folder: string,
	fileStem: string,
	lines: Array<Record<string, unknown> | string>,
): string {
	const filePath = join(baseDir, folder, `${fileStem}.jsonl`);
	mkdirSync(dirname(filePath), { recursive: true });
	const body = `${lines
		.map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
		.join("\n")}\n`;
	writeFileSync(filePath, body, "utf-8");
	return filePath;
}

const PI_SESSION_LINES: Array<Record<string, unknown> | string> = [
	{
		type: "session",
		version: 3,
		id: "raft-pi-session",
		timestamp: "2026-09-24T08:00:00.000Z",
		cwd: "/work/raft",
	},
	{
		type: "message",
		id: "r1",
		timestamp: "2026-09-24T08:00:01.000Z",
		message: { role: "user", content: [{ type: "text", text: "Run the agent" }] },
	},
	{
		type: "message",
		id: "r2",
		timestamp: "2026-09-24T08:00:02.000Z",
		message: {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "Plan it" },
				{ type: "text", text: "On it" },
				{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls" } },
			],
		},
	},
	{
		type: "session_info",
		id: "r3",
		timestamp: "2026-09-24T08:00:03.000Z",
		name: "Raft session",
	},
];

const BUILTIN_SESSION_LINES: Array<Record<string, unknown> | string> = [
	{
		type: "session",
		version: 3,
		id: "raft-builtin-session",
		timestamp: "2026-09-24T09:00:00.000Z",
		cwd: "/work/builtin",
	},
	{
		type: "message",
		id: "c1",
		timestamp: "2026-09-24T09:00:01.000Z",
		message: { role: "user", content: "builtin question" },
	},
	{
		type: "message",
		id: "c2",
		timestamp: "2026-09-24T09:00:02.000Z",
		message: { role: "assistant", content: [{ type: "text", text: "builtin answer" }] },
	},
];

const WSL_SESSION_LINES: Array<Record<string, unknown> | string> = [
	{
		type: "session",
		version: 3,
		id: "raft-wsl-session",
		timestamp: "2026-09-25T08:00:00.000Z",
		cwd: "/home/me/wsl-raft",
	},
	{
		type: "message",
		id: "w1",
		timestamp: "2026-09-25T08:00:01.000Z",
		message: { role: "user", content: [{ type: "text", text: "from wsl raft" }] },
	},
];

test("detect is null without sessions, then counts both agent session folders", async () => {
	assert.equal(await raftAdapter.detect(), null);

	writeTranscript(
		join(raftDataDir, "agents", "agent-1"),
		".pi-sessions",
		"2026-09-24T08-00-00-000Z_raft-pi-session",
		PI_SESSION_LINES,
	);
	writeTranscript(
		join(raftDataDir, "agents", "agent-2"),
		".builtin-sessions",
		"2026-09-24T09-00-00-000Z_raft-builtin-session",
		BUILTIN_SESSION_LINES,
	);
	// Not a session: no `<time>_<id>` file name.
	writeTranscript(
		join(raftDataDir, "agents", "agent-1"),
		".pi-sessions",
		"notes",
		[{ type: "message", message: { role: "user", content: "not a session" } }],
	);
	// Handoff notes are not sessions either.
	writeTranscript(
		join(raftDataDir, "runtime-sessions"),
		"",
		"handoff",
		[{ type: "message", message: { role: "user", content: "handoff" } }],
	);

	const info = await raftAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "raft");
	assert.equal(info.displayName, "Raft");
	assert.equal(info.dataDir, raftDataDir);
	assert.equal(info.conversationCount, 2);

	const metas = await raftAdapter.scan();
	assert.deepEqual(
		metas.map((meta) => meta.id).sort(),
		["raft-builtin-session", "raft-pi-session"],
	);
	for (const meta of metas) {
		assert.equal(meta.source, "raft");
		assert.equal(meta.rootDir, raftDataDir);
	}
	const piSession = metas.find((meta) => meta.id === "raft-pi-session");
	assert.ok(piSession);
	assert.match(piSession.filePath, /\.pi-sessions[/\\]/);
	const builtinSession = metas.find(
		(meta) => meta.id === "raft-builtin-session",
	);
	assert.ok(builtinSession);
	assert.match(builtinSession.filePath, /\.builtin-sessions[/\\]/);

	// The watcher only gets local paths.
	const watchPaths = raftAdapter.watchPaths?.() ?? [];
	assert.equal(watchPaths.length, 2);
	for (const target of watchPaths) {
		assert.ok(target.startsWith(raftDataDir));
	}
});

test("parse reads Raft sessions like Pi's", async () => {
	const metas = await raftAdapter.scan();
	const piSession = metas.find((meta) => meta.id === "raft-pi-session");
	assert.ok(piSession);

	const parsed = await raftAdapter.parse(piSession);
	assert.equal(parsed.id, "raft-pi-session");
	assert.equal(parsed.source, "raft");
	assert.equal(parsed.slug, "Raft session");
	assert.equal(parsed.cwd, "/work/raft");
	assert.equal(parsed.projectDir, "/work/raft");
	assert.equal(parsed.projectName, "raft");
	assert.equal(parsed.messages.length, 2);
	assert.equal(parsed.messages[0].type, "user");
	assert.equal(parsed.messages[0].content, "Run the agent");
	assert.equal(parsed.messages[1].type, "assistant");
	assert.equal(parsed.messages[1].content, "On it");
	assert.equal(parsed.messages[1].hasToolUse, true);
	assert.equal(parsed.messages[1].thinking, "Plan it");
	assert.equal(parsed.firstMessageAt, "2026-09-24T08:00:01.000Z");
	assert.equal(parsed.lastMessageAt, "2026-09-24T08:00:02.000Z");
});

test("parse reads a builtin-runtime session", async () => {
	const metas = await raftAdapter.scan();
	const builtinSession = metas.find(
		(meta) => meta.id === "raft-builtin-session",
	);
	assert.ok(builtinSession);

	const parsed = await raftAdapter.parse(builtinSession);
	assert.equal(parsed.cwd, "/work/builtin");
	assert.deepEqual(
		parsed.messages.map((message) => message.content),
		["builtin question", "builtin answer"],
	);
});

test("WSL distro home sessions are detected, tagged with rootDir and parsed", async () => {
	writeTranscript(
		join(wslRaftDir, "agents", "agent-w"),
		".pi-sessions",
		"2026-09-25T08-00-00-000Z_raft-wsl-session",
		WSL_SESSION_LINES,
	);
	setWslHomesForTesting([wslHome]);
	try {
		const info = await raftAdapter.detect();
		assert.ok(info);
		assert.equal(info.dataDir, raftDataDir);
		assert.equal(info.conversationCount, 3);

		const metas = await raftAdapter.scan();
		const wslMeta = metas.find((meta) => meta.id === "raft-wsl-session");
		assert.ok(wslMeta);
		assert.equal(wslMeta.rootDir, wslRaftDir);
		assert.match(wslMeta.filePath, /wsl-home/);

		const parsed = await raftAdapter.parse(wslMeta);
		assert.equal(parsed.cwd, "/home/me/wsl-raft");
		assert.equal(parsed.messages[0].content, "from wsl raft");

		// watchPaths never returns the injected WSL root.
		for (const target of raftAdapter.watchPaths?.() ?? []) {
			assert.doesNotMatch(target, /wsl/i);
		}
	} finally {
		setWslHomesForTesting(null);
	}
});
