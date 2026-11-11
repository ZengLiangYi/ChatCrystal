import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

// ---------------------------------------------------------------------------
// Self-contained fixture: a fake Continue home under a temp dir. The data-dir
// env var must be set before the adapter (and appConfig) is imported.
// ---------------------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), "chatcrystal-continue-test-"));
const continueDir = join(root, "continue-home");
const sessionsDir = join(continueDir, "sessions");
const indexPath = join(continueDir, "sessions.json");

process.env.DATA_DIR = join(root, "data");
process.env.CONTINUE_DATA_DIR = continueDir;
// A real WSL distro may be running on this machine; keep it out of the tests.
process.env.CHATCRYSTAL_WSL = "0";

const { continueAdapter } = await import("./continue.js");
const { setWslHomesForTesting } = await import("../wsl.js");

after(() => {
	setWslHomesForTesting(null);
	rmSync(root, { recursive: true, force: true });
});

function writeJson(filePath: string, value: unknown): void {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function writeRaw(filePath: string, content: string): void {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, content, "utf-8");
}

function normalizePath(filePath: string): string {
	return filePath.replace(/\\/g, "/");
}

const BASE_ISO = "2026-09-27T10:00:00.000Z";
const MS_BASE = 1790600000000;

let fixturesReady = false;

function ensureFixtures(): void {
	if (fixturesReady) return;
	fixturesReady = true;

	// Real Continue writes this index as an array of session metadata.
	writeJson(indexPath, [
		{
			sessionId: "abc",
			dateCreated: BASE_ISO,
			workspaceDirectory: "file:///work/continue-app",
		},
		{
			id: "def",
			dateCreated: MS_BASE,
			workspace: "/work/second-app",
		},
	]);

	writeJson(join(sessionsDir, "abc.json"), {
		sessionId: "abc",
		title: "Continue chat",
		workspaceDirectory: "file:///work/continue-app",
		history: [
			{ message: { role: "system", content: "You are an AI assistant." } },
			{ message: { role: "user", content: "How do I optimize the build?" } },
			{
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "Running the profiler." },
						{ type: "imageUrl", imageUrl: "data:image/png;base64,AAAA" },
					],
				},
				toolCallStates: [
					{
						status: "done",
						toolCall: { function: { name: "Bash", arguments: "{}" } },
					},
				],
			},
			{ message: { role: "tool", content: "profile output" } },
			{ message: { role: "assistant", content: "Build is 30% faster now." } },
		],
	});

	// Workspace comes from the index; the document omits it.
	writeJson(join(sessionsDir, "def.json"), {
		sessionId: "def",
		history: [
			{ message: { role: "user", content: "Write the docs" } },
			{ message: { role: "assistant", content: "Drafting them." } },
		],
	});

	// Present on disk but absent from sessions.json.
	writeJson(join(sessionsDir, "ghi.json"), {
		sessionId: "ghi",
		history: [
			{ message: { role: "user", content: "Unindexed session" } },
			{ message: { role: "assistant", content: "Still imported." } },
		],
	});

	// Truncated session document: listed by scan, parsed to zero messages.
	writeRaw(join(sessionsDir, "bad.json"), '{"history": [');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("detect returns null when the Continue store is absent", async () => {
	assert.equal(await continueAdapter.detect(), null);
	assert.deepEqual(continueAdapter.watchPaths?.() ?? [], []);
});

test("detect counts Continue session documents", async () => {
	ensureFixtures();
	const info = await continueAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "continue");
	assert.equal(info.displayName, "Continue");
	assert.equal(info.dataDir, continueDir);
	assert.equal(info.conversationCount, 4);
});

test("scan reports session ids, source and decoded workspace dirs", async () => {
	ensureFixtures();
	const metas = await continueAdapter.scan();
	assert.equal(metas.length, 4);
	assert.deepEqual(
		metas.map((meta) => meta.id),
		["abc", "bad", "def", "ghi"],
	);

	const abc = metas.find((meta) => meta.id === "abc");
	assert.ok(abc);
	assert.equal(abc.source, "continue");
	// `file:///work/continue-app` is decoded before it becomes projectDir.
	assert.equal(abc.projectDir, "/work/continue-app");
	assert.ok(normalizePath(abc.filePath).endsWith("sessions/abc.json"));

	const def = metas.find((meta) => meta.id === "def");
	assert.ok(def);
	// `workspace` is accepted as an alias of `workspaceDirectory`.
	assert.equal(def.projectDir, "/work/second-app");

	const ghi = metas.find((meta) => meta.id === "ghi");
	assert.ok(ghi);
	assert.equal(ghi.projectDir, "");
});

test("parse keeps user/assistant turns, skips system/tool and flags tool calls", async () => {
	ensureFixtures();
	const metas = await continueAdapter.scan();
	const meta = metas.find((item) => item.id === "abc");
	assert.ok(meta);

	const parsed = await continueAdapter.parse(meta);
	assert.equal(parsed.id, "abc");
	assert.equal(parsed.source, "continue");
	assert.equal(parsed.slug, "Continue chat");
	assert.equal(parsed.projectDir, "/work/continue-app");
	assert.equal(parsed.projectName, "continue-app");
	assert.equal(parsed.cwd, "/work/continue-app");
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
	assert.equal(parsed.messages[0]?.content, "How do I optimize the build?");
	assert.equal(parsed.messages[1]?.content, "Running the profiler.");
	assert.equal(parsed.messages[1]?.hasToolUse, true);
	assert.equal(parsed.messages[2]?.content, "Build is 30% faster now.");
	assert.equal(parsed.messages[2]?.hasToolUse, false);

	// Turns are laid out one second apart from the index's dateCreated.
	const baseMs = Date.parse(BASE_ISO);
	assert.equal(parsed.messages[0]?.timestamp, BASE_ISO);
	assert.equal(parsed.messages[1]?.timestamp, new Date(baseMs + 1000).toISOString());
	assert.equal(parsed.messages[2]?.timestamp, new Date(baseMs + 2000).toISOString());
	for (const message of parsed.messages) {
		assert.equal(new Date(message.timestamp).toISOString(), message.timestamp);
	}
	assert.equal(parsed.firstMessageAt, BASE_ISO);
	assert.equal(parsed.lastMessageAt, new Date(baseMs + 2000).toISOString());
});

test("parse falls back to index workspace and millisecond dateCreated", async () => {
	ensureFixtures();
	const metas = await continueAdapter.scan();
	const meta = metas.find((item) => item.id === "def");
	assert.ok(meta);

	const parsed = await continueAdapter.parse(meta);
	assert.equal(parsed.slug, "Write the docs");
	assert.equal(parsed.projectDir, "/work/second-app");
	assert.equal(parsed.projectName, "second-app");
	assert.equal(parsed.messages.length, 2);
	assert.equal(parsed.messages[0]?.timestamp, new Date(MS_BASE).toISOString());
	assert.equal(parsed.messages[1]?.timestamp, new Date(MS_BASE + 1000).toISOString());
});

test("parse falls back to file mtime for unindexed sessions", async () => {
	ensureFixtures();
	const metas = await continueAdapter.scan();
	const meta = metas.find((item) => item.id === "ghi");
	assert.ok(meta);

	const parsed = await continueAdapter.parse(meta);
	assert.equal(parsed.slug, "Unindexed session");
	assert.equal(parsed.projectDir, "");
	assert.equal(parsed.projectName, "Unknown");
	const baseMs = Date.parse(meta.fileMtime);
	assert.equal(parsed.messages[0]?.timestamp, new Date(baseMs).toISOString());
	assert.equal(parsed.messages[1]?.timestamp, new Date(baseMs + 1000).toISOString());
});

test("parse tolerates a corrupt session document", async () => {
	ensureFixtures();
	const metas = await continueAdapter.scan();
	const meta = metas.find((item) => item.id === "bad");
	assert.ok(meta);

	const parsed = await continueAdapter.parse(meta);
	assert.deepEqual(parsed.messages, []);
	assert.equal(parsed.slug, null);
	assert.equal(parsed.projectDir, "");
});

test("watchPaths covers session documents", () => {
	ensureFixtures();
	const paths = (continueAdapter.watchPaths?.() ?? []).map(normalizePath);
	assert.equal(paths.length, 1);
	assert.ok(paths[0]?.endsWith("sessions/*.json"));
});

test("sessions.json also accepts a { sessions: [...] } object index", async () => {
	ensureFixtures();
	// Let the index file's mtime move so the adapter's mtime cache refreshes.
	await new Promise((resolve) => setTimeout(resolve, 30));
	writeJson(indexPath, {
		sessions: [
			{
				sessionId: "abc",
				dateCreated: BASE_ISO,
				workspaceDirectory: "file:///work/continue-app",
			},
			{
				id: "def",
				dateCreated: MS_BASE,
				workspace: "/work/second-app",
			},
			{
				sessionId: "jkl",
				dateCreated: BASE_ISO,
				workspaceDirectory: "file:///work/third-app",
			},
		],
	});
	writeJson(join(sessionsDir, "jkl.json"), {
		sessionId: "jkl",
		history: [{ message: { role: "user", content: "Brand new session" } }],
	});

	const metas = await continueAdapter.scan();
	assert.equal(metas.length, 5);
	const jkl = metas.find((meta) => meta.id === "jkl");
	assert.ok(jkl);
	assert.equal(jkl.projectDir, "/work/third-app");

	const parsed = await continueAdapter.parse(jkl);
	assert.equal(parsed.projectDir, "/work/third-app");
	assert.equal(parsed.slug, "Brand new session");
});

test("detect counts sessions added after rescan", async () => {
	ensureFixtures();
	const info = await continueAdapter.detect();
	assert.ok(info);
	assert.equal(info.conversationCount, 5);
});

test("WSL distro sessions use that root's sessions.json index", async () => {
	ensureFixtures();
	const wslHome = join(root, "wsl-home");
	const wslRoot = join(wslHome, ".continue");
	const wslSessionsDir = join(wslRoot, "sessions");
	const wslSessionId = "wsl-session";
	// The index of the WSL root is the only place the workspace/date comes from.
	writeJson(join(wslRoot, "sessions.json"), [
		{
			sessionId: wslSessionId,
			dateCreated: "2026-10-01T09:00:00.000Z",
			workspaceDirectory: "file:///home/me/continue-wsl-app",
		},
	]);
	writeJson(join(wslSessionsDir, `${wslSessionId}.json`), {
		sessionId: wslSessionId,
		history: [
			{ message: { role: "user", content: "WSL continue question" } },
			{ message: { role: "assistant", content: "WSL continue answer" } },
		],
	});

	setWslHomesForTesting([wslHome]);
	try {
		const info = await continueAdapter.detect();
		assert.ok(info);
		// The five local sessions (four fixtures + "jkl") and one WSL session.
		assert.equal(info.conversationCount, 6);
		// detect still reports the primary Windows root.
		assert.equal(info.dataDir, continueDir);

		const metas = await continueAdapter.scan();
		assert.equal(metas.length, 6);
		const wslMeta = metas.find((meta) => meta.id === wslSessionId);
		assert.ok(wslMeta);
		assert.equal(wslMeta.source, "continue");
		assert.equal(wslMeta.rootDir, wslRoot);
		// The workspace comes from the WSL root's sessions.json, not the local one.
		assert.equal(wslMeta.projectDir, "/home/me/continue-wsl-app");
		assert.ok(normalizePath(wslMeta.filePath).includes("wsl-home/.continue/sessions"));
		assert.ok(
			normalizePath(wslMeta.filePath).endsWith(`${wslSessionId}.json`),
		);

		const parsed = await continueAdapter.parse(wslMeta);
		assert.equal(parsed.id, wslSessionId);
		assert.equal(parsed.projectDir, "/home/me/continue-wsl-app");
		assert.equal(parsed.projectName, "continue-wsl-app");
		assert.equal(parsed.messages.length, 2);
		assert.equal(parsed.messages[0]?.content, "WSL continue question");
		assert.equal(parsed.messages[1]?.content, "WSL continue answer");
		// dateCreated comes from the WSL root's index.
		assert.equal(parsed.messages[0]?.timestamp, "2026-10-01T09:00:00.000Z");
		assert.equal(parsed.messages[1]?.timestamp, "2026-10-01T09:00:01.000Z");

		// The watcher must stay on local Windows paths only.
		const paths = (continueAdapter.watchPaths?.() ?? []).map(normalizePath);
		assert.equal(paths.length, 1);
		assert.ok(!paths[0]?.includes("wsl-home"));
	} finally {
		setWslHomesForTesting(null);
	}
});
