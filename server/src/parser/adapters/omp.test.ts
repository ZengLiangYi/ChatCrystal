import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

const fixtureRoot = mkdtempSync(join(tmpdir(), "cc-omp-"));
const ompDataDir = join(fixtureRoot, "agent");
const profilesDir = join(fixtureRoot, "profiles");
const wslHome = join(fixtureRoot, "wsl-home");
const wslOmpDir = join(wslHome, ".omp", "agent");

// appConfig freezes when config.ts is first imported: point omp's agent folder
// at the fixture and keep this machine's real WSL distros out of it *before*
// importing the adapter. The WSL test injects its own home.
process.env.OMP_DATA_DIR = ompDataDir;
process.env.CHATCRYSTAL_WSL = "0";

const { ompAdapter } = await import("./omp.js");
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

const LOCAL_LINES: Array<Record<string, unknown> | string> = [
	// omp rewrites this fixed-width title line in place; title_change wins.
	{
		type: "title",
		v: 1,
		title: "Stale local title",
		source: "auto",
		updatedAt: "2026-09-28T08:01:10.000Z",
		pad: "    ",
	},
	{
		type: "session",
		version: 3,
		id: "session-a",
		title: "Port the parser",
		titleSource: "auto",
		timestamp: "2026-09-28T08:00:00.000Z",
		cwd: "/work/omp",
	},
	{
		type: "model_change",
		id: "a1",
		timestamp: "2026-09-28T08:00:00.100Z",
		model: "anthropic/claude-opus-5-5",
		role: "default",
	},
	{
		type: "message",
		id: "a2",
		timestamp: "2026-09-28T08:00:01.000Z",
		message: { role: "user", content: [{ type: "text", text: "Port the parser" }] },
	},
	{
		type: "message",
		id: "a3",
		timestamp: "2026-09-28T08:00:05.000Z",
		message: {
			role: "assistant",
			content: [
				{ type: "text", text: "ok" },
				{
					type: "toolCall",
					id: "call-1",
					name: "read",
					arguments: { path: "/work/omp/pi.ts" },
				},
			],
		},
	},
	{
		type: "model_usage",
		id: "a4",
		timestamp: "2026-09-28T08:00:06.000Z",
		purpose: "title",
		model: "claude-haiku-5",
		usage: { input: 20, output: 5 },
	},
	{
		type: "message",
		id: "a5",
		timestamp: "2026-09-28T08:00:50.000Z",
		message: {
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "read",
			content: [{ type: "text", text: "file" }],
		},
	},
	{
		type: "message",
		id: "a6",
		timestamp: "2026-09-28T08:01:00.000Z",
		message: { role: "assistant", content: [{ type: "text", text: "done" }] },
	},
	{
		type: "title_change",
		id: "a7",
		timestamp: "2026-09-28T08:01:10.000Z",
		title: "Port the parser to omp",
		previousTitle: "Port the parser",
	},
	{
		type: "compaction",
		id: "a8",
		timestamp: "2026-09-28T08:02:00.000Z",
		summary: "Ported.",
	},
];

const PROFILE_LINES: Array<Record<string, unknown> | string> = [
	// The header's own title is read after the leading title line, so it wins.
	{ type: "title", v: 1, title: "Stale profile title" },
	{
		type: "session",
		version: 3,
		id: "session-b",
		title: "Profile session",
		timestamp: "2026-09-29T09:00:00.000Z",
		cwd: "/work/prof",
	},
	{
		type: "message",
		id: "b1",
		timestamp: "2026-09-29T09:00:01.000Z",
		message: { role: "user", content: [{ type: "text", text: "hello profile" }] },
	},
	{
		type: "message",
		id: "b2",
		timestamp: "2026-09-29T09:00:02.000Z",
		message: { role: "assistant", content: [{ type: "text", text: "profile answer" }] },
	},
];

const WSL_LINES: Array<Record<string, unknown> | string> = [
	{
		type: "session",
		version: 3,
		id: "session-wsl",
		title: "WSL omp session",
		timestamp: "2026-09-30T08:00:00.000Z",
		cwd: "/home/me/wsl-omp",
	},
	{
		type: "message",
		id: "w1",
		timestamp: "2026-09-30T08:00:01.000Z",
		message: { role: "user", content: [{ type: "text", text: "from wsl omp" }] },
	},
];

const WSL_PROFILE_LINES: Array<Record<string, unknown> | string> = [
	{
		type: "session",
		version: 3,
		id: "session-wsl-prof",
		timestamp: "2026-09-30T09:00:00.000Z",
		cwd: "/home/me/wsl-prof",
	},
	{
		type: "message",
		id: "p1",
		timestamp: "2026-09-30T09:00:01.000Z",
		message: { role: "user", content: [{ type: "text", text: "wsl profile" }] },
	},
];

test("detect is null without sessions, then counts the default store and profiles", async () => {
	assert.equal(await ompAdapter.detect(), null);

	writeTranscript(
		join(ompDataDir, "sessions"),
		"--work-omp--",
		"2026-09-28T08-00-00-000Z_session-a",
		LOCAL_LINES,
	);
	writeTranscript(
		join(profilesDir, "work", "agent", "sessions"),
		"-work-prof--",
		"2026-09-29T09-00-00-000Z_session-b",
		PROFILE_LINES,
	);

	const info = await ompAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "omp");
	assert.equal(info.displayName, "oh-my-pi");
	assert.equal(info.dataDir, ompDataDir);
	assert.equal(info.conversationCount, 2);

	const metas = await ompAdapter.scan();
	assert.deepEqual(
		metas.map((meta) => meta.id).sort(),
		["session-a", "session-b"],
	);
	for (const meta of metas) {
		assert.equal(meta.source, "omp");
		// Profile stores hang off the same agent folder, so both carry its root.
		assert.equal(meta.rootDir, ompDataDir);
	}
	const local = metas.find((meta) => meta.id === "session-a");
	assert.ok(local);
	assert.equal(local.projectDir, "--work-omp--");
	assert.equal(local.filePath, join(ompDataDir, "sessions", "--work-omp--", "2026-09-28T08-00-00-000Z_session-a.jsonl"));

	const profile = metas.find((meta) => meta.id === "session-b");
	assert.ok(profile);
	assert.equal(profile.projectDir, "-work-prof--");
	assert.equal(
		profile.filePath,
		join(profilesDir, "work", "agent", "sessions", "-work-prof--", "2026-09-29T09-00-00-000Z_session-b.jsonl"),
	);

	// The watcher only gets local paths.
	const watchPaths = ompAdapter.watchPaths?.() ?? [];
	assert.equal(watchPaths.length, 2);
	for (const target of watchPaths) {
		assert.ok(target.startsWith(fixtureRoot));
	}
});

test("parse reads omp messages and takes the last title change", async () => {
	const metas = await ompAdapter.scan();
	const local = metas.find((meta) => meta.id === "session-a");
	assert.ok(local);

	const parsed = await ompAdapter.parse(local);
	assert.equal(parsed.id, "session-a");
	assert.equal(parsed.source, "omp");
	assert.equal(parsed.slug, "Port the parser to omp");
	assert.equal(parsed.cwd, "/work/omp");
	assert.equal(parsed.projectDir, "/work/omp");
	assert.equal(parsed.projectName, "omp");
	assert.deepEqual(
		parsed.messages.map((message) => message.type),
		["user", "assistant", "assistant"],
	);
	assert.equal(parsed.messages[0].content, "Port the parser");
	assert.equal(parsed.messages[1].content, "ok");
	assert.equal(parsed.messages[1].hasToolUse, true);
	assert.equal(parsed.messages[2].content, "done");
	// model_usage and compaction are bookkeeping, not turns.
	assert.equal(parsed.messages[2].hasToolUse, false);
	assert.equal(parsed.firstMessageAt, "2026-09-28T08:00:01.000Z");
	assert.equal(parsed.lastMessageAt, "2026-09-28T08:01:00.000Z");
});

test("parse prefers the header title over omp's leading title line", async () => {
	const metas = await ompAdapter.scan();
	const profile = metas.find((meta) => meta.id === "session-b");
	assert.ok(profile);

	const parsed = await ompAdapter.parse(profile);
	assert.equal(parsed.slug, "Profile session");
	assert.equal(parsed.cwd, "/work/prof");
	assert.equal(parsed.messages.length, 2);
	assert.deepEqual(
		parsed.messages.map((message) => message.content),
		["hello profile", "profile answer"],
	);
});

test("WSL distro home sessions and profiles are detected and tagged with rootDir", async () => {
	writeTranscript(
		join(wslOmpDir, "sessions"),
		"--wsl-omp--",
		"2026-09-30T08-00-00-000Z_session-wsl",
		WSL_LINES,
	);
	writeTranscript(
		join(wslHome, ".omp", "profiles", "wsl", "agent", "sessions"),
		"--wsl-prof--",
		"2026-09-30T09-00-00-000Z_session-wsl-prof",
		WSL_PROFILE_LINES,
	);
	setWslHomesForTesting([wslHome]);
	try {
		const info = await ompAdapter.detect();
		assert.ok(info);
		assert.equal(info.dataDir, ompDataDir);
		assert.equal(info.conversationCount, 4);

		const metas = await ompAdapter.scan();
		const fromWsl = metas.filter((meta) =>
			["session-wsl", "session-wsl-prof"].includes(meta.id),
		);
		assert.equal(fromWsl.length, 2);
		for (const meta of fromWsl) {
			assert.equal(meta.rootDir, wslOmpDir);
			assert.match(meta.filePath, /wsl-home/);
		}

		const parsed = await ompAdapter.parse(fromWsl[0]);
		assert.equal(parsed.cwd, "/home/me/wsl-omp");
		assert.equal(parsed.messages.length, 1);

		// watchPaths never returns the injected WSL root.
		for (const target of ompAdapter.watchPaths?.() ?? []) {
			assert.doesNotMatch(target, /wsl/i);
		}
	} finally {
		setWslHomesForTesting(null);
	}
});
