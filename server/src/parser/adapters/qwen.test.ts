import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

// The adapter reads its data directory from appConfig, which is populated when
// the config module is first imported. Point the env var at a fixture root
// before importing the adapter.
const fixtureRoot = mkdtempSync(join(tmpdir(), "chatcrystal-qwen-"));
const wslHome = mkdtempSync(join(tmpdir(), "chatcrystal-qwen-wsl-home-"));
const wslRoot = join(wslHome, ".qwen");
process.env.QWEN_DATA_DIR = fixtureRoot;
// Keep the developer's real WSL distros out of these fixtures; the WSL test
// injects its own home through setWslHomesForTesting().
process.env.CHATCRYSTAL_WSL = "0";

const { qwenAdapter } = await import("./qwen.js");
const { setWslHomesForTesting } = await import("../wsl.js");

after(() => {
	setWslHomesForTesting(null);
	rmSync(fixtureRoot, { recursive: true, force: true });
	rmSync(wslHome, { recursive: true, force: true });
});

function resetFixtureRoot(): void {
	rmSync(fixtureRoot, { recursive: true, force: true });
	mkdirSync(fixtureRoot, { recursive: true });
}

function writeFixture(relativePath: string, content: string): string {
	const filePath = join(fixtureRoot, relativePath);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, content, "utf-8");
	return filePath;
}

/** Write a fixture relative to the injected WSL home (same layout as above). */
function writeWslFixture(relativePath: string, content: string): string {
	const filePath = join(wslRoot, relativePath);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, content, "utf-8");
	return filePath;
}

function writeJsonlFixture(relativePath: string, lines: unknown[]): string {
	const content = lines
		.map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
		.join("\n");
	return writeFixture(relativePath, content);
}

function findMeta(metas: Awaited<ReturnType<typeof qwenAdapter.scan>>, id: string) {
	const meta = metas.find((item) => item.id === id);
	assert.ok(meta, `expected scanned conversation ${id}`);
	return meta;
}

test("detect returns null and scan is empty when no sessions exist", async () => {
	resetFixtureRoot();
	assert.equal(await qwenAdapter.detect(), null);
	assert.deepEqual(await qwenAdapter.scan(), []);
});

test("parses a Qwen Code transcript into ordered user and assistant turns", async () => {
	resetFixtureRoot();

	const filePath = writeJsonlFixture(
		join(
			"projects",
			"-home-fixture-qwen-app",
			"chats",
			"123e4567-e89b-12d3-a456-426614174000.jsonl",
		),
		[
			{
				uuid: "u1",
				parentUuid: null,
				sessionId: "qwen-session-1",
				timestamp: "2026-08-01T09:00:01.000Z",
				type: "user",
				cwd: "/home/fixture/qwen-app",
				version: "0.20.0",
				message: {
					role: "user",
					parts: [{ text: "Why does the parser drop my prompt?" }],
				},
			},
			{
				uuid: "a1",
				parentUuid: "u1",
				sessionId: "qwen-session-1",
				timestamp: "2026-08-01T09:00:02.000Z",
				type: "assistant",
				cwd: "/home/fixture/qwen-app",
				message: {
					role: "model",
					parts: [
						{ text: "Let me look at the reader." },
						{ text: "I should check how JSONL lines are parsed.", thought: true },
						{ functionCall: { name: "read_file", args: { file_path: "reader.ts" } } },
						{ text: "The last line was malformed." },
					],
				},
			},
			{
				uuid: "t1",
				sessionId: "qwen-session-1",
				timestamp: "2026-08-01T09:00:02.500Z",
				type: "tool_result",
				cwd: "/home/fixture/qwen-app",
				message: {
					role: "user",
					parts: [{ functionResponse: { name: "read_file", response: {} } }],
				},
			},
			"this line is not JSON and must be skipped",
			{
				uuid: "a2",
				parentUuid: "a1",
				sessionId: "qwen-session-1",
				type: "assistant",
				cwd: "/home/fixture/qwen-app",
				message: { role: "model", parts: [{ text: "Done." }] },
			},
			{
				sessionId: "qwen-session-1",
				type: "system",
				timestamp: "2026-08-01T09:00:04.000Z",
				message: { role: "user", parts: [{ text: "compression checkpoint" }] },
			},
		],
	);

	const info = await qwenAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "qwen");
	assert.equal(info.displayName, "Qwen Code");
	assert.equal(info.dataDir, fixtureRoot);
	assert.equal(info.conversationCount, 1);

	const metas = await qwenAdapter.scan();
	assert.equal(metas.length, 1);
	const meta = findMeta(metas, "qwen-session-1");
	assert.equal(meta.source, "qwen");
	assert.equal(meta.filePath, filePath);
	assert.equal(meta.projectDir, "/home/fixture/qwen-app");
	assert.ok(meta.fileSize > 0);
	assert.ok(!Number.isNaN(Date.parse(meta.fileMtime)));

	const parsed = await qwenAdapter.parse(meta);
	assert.equal(parsed.id, "qwen-session-1");
	assert.equal(parsed.source, "qwen");
	assert.equal(parsed.slug, null);
	assert.equal(parsed.projectDir, "/home/fixture/qwen-app");
	assert.equal(parsed.projectName, "qwen-app");
	assert.equal(parsed.cwd, "/home/fixture/qwen-app");
	assert.equal(parsed.gitBranch, null);

	assert.deepEqual(
		parsed.messages.map((message) => message.id),
		["u1", "a1", "a2"],
	);
	assert.deepEqual(
		parsed.messages.map((message) => message.type),
		["user", "assistant", "assistant"],
	);
	assert.deepEqual(
		parsed.messages.map((message) => message.role),
		["user", "assistant", "assistant"],
	);

	const userMessage = parsed.messages[0];
	assert.equal(userMessage.content, "Why does the parser drop my prompt?");
	assert.equal(userMessage.thinking, null);
	assert.equal(userMessage.hasToolUse, false);
	assert.equal(userMessage.hasCode, false);

	const assistantMessage = parsed.messages[1];
	assert.equal(assistantMessage.parentUuid, "u1");
	assert.equal(
		assistantMessage.content,
		"Let me look at the reader.\nThe last line was malformed.",
	);
	assert.equal(
		assistantMessage.thinking,
		"I should check how JSONL lines are parsed.",
	);
	assert.equal(assistantMessage.hasToolUse, true);
	assert.equal(assistantMessage.timestamp, "2026-08-01T09:00:02.000Z");

	// The record without a timestamp falls back to the file's mtime.
	assert.equal(
		parsed.messages[2].timestamp,
		statSync(filePath).mtime.toISOString(),
	);
	assert.equal(parsed.messages[2].content, "Done.");
	assert.equal(parsed.firstMessageAt, "2026-08-01T09:00:01.000Z");
	assert.equal(parsed.lastMessageAt, parsed.messages[2].timestamp);
});

test("decodes the mangled project folder when no cwd is recorded", async () => {
	resetFixtureRoot();

	writeJsonlFixture(
		join(
			"projects",
			"-home-fixture-mangled-app",
			"chats",
			"no-cwd-session.jsonl",
		),
		[
			{
				uuid: "m1",
				sessionId: "qwen-no-cwd",
				timestamp: "2026-08-02T10:00:01.000Z",
				type: "user",
				message: { role: "user", parts: [{ text: "hello" }] },
			},
			{
				// A legacy record that only carries the message role, no top-level type.
				uuid: "m2",
				sessionId: "qwen-no-cwd",
				timestamp: "2026-08-02T10:00:02.000Z",
				message: { role: "model", parts: [{ text: "hi there" }] },
			},
		],
	);

	// Subagent transcripts sit below subagents/<session>/ and are not main chats.
	writeJsonlFixture(
		join(
			"projects",
			"-home-fixture-mangled-app",
			"subagents",
			"qwen-no-cwd",
			"agent-1.jsonl",
		),
		[
			{
				uuid: "s1",
				sessionId: "subagent-session",
				timestamp: "2026-08-02T10:00:03.000Z",
				type: "user",
				message: { role: "user", parts: [{ text: "subagent task" }] },
			},
		],
	);

	const metas = await qwenAdapter.scan();
	assert.equal(metas.length, 1);
	const meta = findMeta(metas, "qwen-no-cwd");
	assert.equal(meta.projectDir, "/home/fixture/mangled/app");

	const parsed = await qwenAdapter.parse(meta);
	assert.equal(parsed.projectDir, "/home/fixture/mangled/app");
	assert.equal(parsed.projectName, "app");
	assert.equal(parsed.cwd, "/home/fixture/mangled/app");
	assert.deepEqual(
		parsed.messages.map((message) => message.type),
		["user", "assistant"],
	);
	assert.equal(parsed.messages[1].content, "hi there");
});

test("tolerates transcripts that contain only corrupt lines", async () => {
	resetFixtureRoot();
	writeFixture(
		join("projects", "-tmp-broken", "chats", "broken-session.jsonl"),
		"not json at all\n{\"partial\":",
	);

	const metas = await qwenAdapter.scan();
	assert.equal(metas.length, 1);
	const meta = metas[0];
	assert.equal(meta.id, "broken-session");
	const parsed = await qwenAdapter.parse(meta);
	assert.equal(parsed.id, "broken-session");
	assert.deepEqual(parsed.messages, []);
	assert.equal(parsed.projectName, "broken");
	assert.ok(!Number.isNaN(Date.parse(parsed.firstMessageAt)));
});

test("detect, scan and parse include sessions from a WSL distro home", async () => {
	resetFixtureRoot();
	// A transcript in the local Qwen home.
	writeJsonlFixture(
		join("projects", "-home-fixture-local-app", "chats", "local-session.jsonl"),
		[
			{
				uuid: "l1",
				sessionId: "local-qwen-session",
				timestamp: "2026-08-04T09:00:01.000Z",
				type: "user",
				cwd: "/home/fixture/local-app",
				message: { role: "user", parts: [{ text: "local question" }] },
			},
		],
	);
	// The same `<root>/projects/<mangled>/chats/*.jsonl` layout inside WSL.
	const wslFile = writeWslFixture(
		join(
			"projects",
			"-home-wsl-user-code-wsl-app",
			"chats",
			"wsl-session.jsonl",
		),
		[
			JSON.stringify({
				uuid: "w1",
				sessionId: "wsl-qwen-session",
				timestamp: "2026-08-04T10:00:01.000Z",
				type: "user",
				cwd: "/home/wsl-user/code/wsl-app",
				message: { role: "user", parts: [{ text: "wsl question" }] },
			}),
			JSON.stringify({
				uuid: "w2",
				sessionId: "wsl-qwen-session",
				timestamp: "2026-08-04T10:00:02.000Z",
				type: "assistant",
				cwd: "/home/wsl-user/code/wsl-app",
				message: { role: "model", parts: [{ text: "wsl answer" }] },
			}),
		].join("\n"),
	);

	setWslHomesForTesting([wslHome]);
	try {
		const info = await qwenAdapter.detect();
		assert.ok(info);
		assert.equal(info.dataDir, fixtureRoot);
		// One conversation locally plus one inside the WSL distro home.
		assert.equal(info.conversationCount, 2);

		const metas = await qwenAdapter.scan();
		assert.equal(metas.length, 2);
		const local = findMeta(metas, "local-qwen-session");
		assert.equal(local.rootDir, fixtureRoot);
		const wsl = findMeta(metas, "wsl-qwen-session");
		assert.equal(wsl.rootDir, wslRoot);
		assert.equal(wsl.filePath, wslFile);
		assert.ok(wsl.filePath.startsWith(wslHome));
		assert.equal(wsl.projectDir, "/home/wsl-user/code/wsl-app");

		const parsed = await qwenAdapter.parse(wsl);
		assert.equal(parsed.id, "wsl-qwen-session");
		assert.equal(parsed.projectDir, "/home/wsl-user/code/wsl-app");
		assert.equal(parsed.projectName, "wsl-app");
		assert.deepEqual(
			parsed.messages.map((message) => [message.type, message.content]),
			[
				["user", "wsl question"],
				["assistant", "wsl answer"],
			],
		);

		// WSL roots are not watched: the watcher only tracks local Windows paths.
		const watched = qwenAdapter.watchPaths?.() ?? [];
		for (const path of watched) assert.ok(!path.startsWith(wslHome));
	} finally {
		setWslHomesForTesting(null);
	}
});

test("watchPaths points at the chats tree", async () => {
	resetFixtureRoot();
	const paths = qwenAdapter.watchPaths?.() ?? [];
	assert.equal(paths.length, 1);
	assert.ok(paths[0].includes("projects"));
	assert.ok(paths[0].includes("**"));
});
