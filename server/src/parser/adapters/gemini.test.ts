import assert from "node:assert/strict";
import { mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

// The adapter reads its data directory from appConfig, which is populated when
// the config module is first imported. Point the env var at a fixture root
// before importing the adapter.
const fixtureRoot = mkdtempSync(join(tmpdir(), "chatcrystal-gemini-"));
const wslHome = mkdtempSync(join(tmpdir(), "chatcrystal-gemini-wsl-home-"));
const wslRoot = join(wslHome, ".gemini");
process.env.GEMINI_DATA_DIR = fixtureRoot;
// Keep the developer's real WSL distros out of these fixtures; the WSL test
// injects its own home through setWslHomesForTesting().
process.env.CHATCRYSTAL_WSL = "0";

const { geminiAdapter } = await import("./gemini.js");
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

function writeJsonFixture(relativePath: string, value: unknown): string {
	return writeFixture(relativePath, JSON.stringify(value, null, 2));
}

/** Marker Gemini writes per project next to the chats directory. */
function writeProjectRootMarker(projectId: string, cwd: string): void {
	writeFixture(join("tmp", projectId, ".project_root"), cwd);
}

function findMeta(metas: Awaited<ReturnType<typeof geminiAdapter.scan>>, id: string) {
	const meta = metas.find((item) => item.id === id);
	assert.ok(meta, `expected scanned conversation ${id}`);
	return meta;
}

test("detect returns null and scan is empty when no sessions exist", async () => {
	resetFixtureRoot();
	assert.equal(await geminiAdapter.detect(), null);
	assert.deepEqual(await geminiAdapter.scan(), []);
});

test("parses a legacy whole-session JSON snapshot", async () => {
	resetFixtureRoot();
	writeProjectRootMarker("legacy-project", "/home/fixture/legacy-app");

	const filePath = writeJsonFixture(
		join(
			"tmp",
			"legacy-project",
			"chats",
			"session-2026-07-17T09-00-legacy1.json",
		),
		{
			sessionId: "legacy-session-1",
			projectHash: "hash-1",
			startTime: "2026-07-17T09:00:00.000Z",
			lastUpdated: "2026-07-17T09:00:05.000Z",
			messages: [
				{
					id: "m1",
					timestamp: "2026-07-17T09:00:01.000Z",
					type: "user",
					content: [{ text: "How do I fix the parser?" }],
				},
				{
					id: "m2",
					timestamp: "2026-07-17T09:00:02.000Z",
					type: "info",
					content: "Session started",
				},
				{
					id: "m3",
					timestamp: "2026-07-17T09:00:03.000Z",
					type: "gemini",
					content: "Found the bug.\n```ts\nconst x = 1;\n```",
					thoughts: [
						{
							subject: "Investigate",
							description: "Look at the parser",
							timestamp: "2026-07-17T09:00:02.500Z",
						},
					],
					toolCalls: [
						{
							id: "tool-1",
							name: "read_file",
							args: { file_path: "parser.ts" },
							status: "success",
							result: [],
						},
					],
				},
				{
					id: "m4",
					timestamp: "2026-07-17T09:00:04.000Z",
					type: "error",
					content: "something failed",
				},
				{
					id: "m5",
					timestamp: "2026-07-17T09:00:05.000Z",
					type: "user",
					content: [
						{
							functionResponse: {
								name: "read_file",
								response: { output: "contents" },
							},
						},
					],
				},
			],
		},
	);

	const info = await geminiAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "gemini");
	assert.equal(info.displayName, "Gemini CLI");
	assert.equal(info.dataDir, fixtureRoot);
	assert.equal(info.conversationCount, 1);

	const metas = await geminiAdapter.scan();
	assert.equal(metas.length, 1);
	const meta = findMeta(metas, "legacy-session-1");
	assert.equal(meta.source, "gemini");
	assert.equal(meta.filePath, filePath);
	assert.ok(meta.fileSize > 0);
	assert.equal(meta.projectDir, "/home/fixture/legacy-app");
	assert.ok(!Number.isNaN(Date.parse(meta.fileMtime)));

	const parsed = await geminiAdapter.parse(meta);
	assert.equal(parsed.id, "legacy-session-1");
	assert.equal(parsed.source, "gemini");
	assert.equal(parsed.slug, null);
	assert.equal(parsed.projectDir, "/home/fixture/legacy-app");
	assert.equal(parsed.projectName, "legacy-app");
	assert.equal(parsed.cwd, "/home/fixture/legacy-app");
	assert.equal(parsed.gitBranch, null);

	assert.equal(parsed.messages.length, 2);
	const [userMessage, assistantMessage] = parsed.messages;
	assert.equal(userMessage.id, "m1");
	assert.equal(userMessage.type, "user");
	assert.equal(userMessage.role, "user");
	assert.equal(userMessage.content, "How do I fix the parser?");
	assert.equal(userMessage.hasToolUse, false);
	assert.equal(userMessage.hasCode, false);
	assert.equal(userMessage.thinking, null);
	assert.equal(userMessage.timestamp, "2026-07-17T09:00:01.000Z");

	assert.equal(assistantMessage.id, "m3");
	assert.equal(assistantMessage.type, "assistant");
	assert.equal(assistantMessage.role, "assistant");
	assert.equal(assistantMessage.hasToolUse, true);
	assert.equal(assistantMessage.hasCode, true);
	assert.equal(assistantMessage.thinking, "Investigate: Look at the parser");
	assert.equal(assistantMessage.timestamp, "2026-07-17T09:00:03.000Z");

	assert.equal(parsed.firstMessageAt, "2026-07-17T09:00:01.000Z");
	assert.equal(parsed.lastMessageAt, "2026-07-17T09:00:03.000Z");
});

test("parses an append-only JSONL session log with replay records", async () => {
	resetFixtureRoot();
	writeProjectRootMarker("jsonl-project", "/home/fixture/jsonl-app");

	const filePath = writeFixture(
		join(
			"tmp",
			"jsonl-project",
			"chats",
			"session-2026-07-18T10-00-jsonl1.jsonl",
		),
		[
			JSON.stringify({
				sessionId: "jsonl-session-1",
				projectHash: "hash-2",
				startTime: "2026-07-18T10:00:00.000Z",
				lastUpdated: "2026-07-18T10:00:00.000Z",
			}),
			JSON.stringify({
				id: "a1",
				timestamp: "2026-07-18T10:00:01.000Z",
				type: "user",
				content: "Please explain replay logs",
			}),
			"this line is not JSON and must be skipped",
			JSON.stringify({
				id: "a2",
				timestamp: "2026-07-18T10:00:02.000Z",
				type: "gemini",
				content: [
					{ text: "Replay logs are append-only." },
					{ text: "thinking here", thought: true },
				],
			}),
			JSON.stringify({
				$patch: {
					id: "a2",
					content: [
						{ text: "Replay logs are append-only." },
						{ text: "and rewindable" },
					],
				},
			}),
			JSON.stringify({
				id: "a3",
				timestamp: "2026-07-18T10:00:03.000Z",
				type: "gemini",
				content: [{ text: "Done." }],
			}),
			JSON.stringify({ $rewindTo: "a3" }),
			JSON.stringify({
				id: "a4",
				timestamp: "2026-07-18T10:00:04.500Z",
				type: "user",
				content: [{ text: "One more question" }],
			}),
			JSON.stringify({ $set: { lastUpdated: "2026-07-18T10:00:05.000Z" } }),
		].join("\n"),
	);

	const metas = await geminiAdapter.scan();
	assert.equal(metas.length, 1);
	const meta = findMeta(metas, "jsonl-session-1");
	assert.equal(meta.filePath, filePath);
	assert.equal(meta.projectDir, "/home/fixture/jsonl-app");

	const parsed = await geminiAdapter.parse(meta);
	assert.equal(parsed.projectName, "jsonl-app");
	assert.equal(parsed.slug, null);
	assert.deepEqual(
		parsed.messages.map((message) => message.id),
		["a1", "a2", "a4"],
	);
	assert.deepEqual(
		parsed.messages.map((message) => message.type),
		["user", "assistant", "user"],
	);
	assert.equal(
		parsed.messages[1].content,
		"Replay logs are append-only.\nand rewindable",
	);
	// The $patch replaced the content and dropped the thought part.
	assert.equal(parsed.messages[1].thinking, null);
	assert.equal(parsed.messages[2].content, "One more question");
	assert.equal(parsed.lastMessageAt, "2026-07-18T10:00:04.500Z");
});

test("falls back to the file mtime when a message has no timestamp", async () => {
	resetFixtureRoot();

	const filePath = writeFixture(
		join(
			"tmp",
			"fallback-project",
			"chats",
			"session-2026-07-19T09-00-fallback.jsonl",
		),
		[
			JSON.stringify({ sessionId: "fallback-session" }),
			JSON.stringify({
				id: "f1",
				type: "user",
				content: "No timestamp here",
			}),
		].join("\n"),
	);

	const fileMtime = statSync(filePath).mtime.toISOString();
	const metas = await geminiAdapter.scan();
	const meta = findMeta(metas, "fallback-session");
	const parsed = await geminiAdapter.parse(meta);
	assert.equal(parsed.messages.length, 1);
	assert.equal(parsed.messages[0].timestamp, fileMtime);
	assert.equal(parsed.firstMessageAt, fileMtime);
});

test("imports only the newest file when a session exists as JSON and JSONL", async () => {
	resetFixtureRoot();

	const chatsDir = join(fixtureRoot, "tmp", "dup-project", "chats");
	mkdirSync(chatsDir, { recursive: true });

	const jsonlPath = join(chatsDir, "session-2026-07-20T09-00-dupsess.jsonl");
	const jsonPath = join(chatsDir, "session-2026-07-20T09-00-dupsess.json");
	writeFileSync(
		jsonlPath,
		[
			JSON.stringify({ sessionId: "dup-session" }),
			JSON.stringify({
				id: "d1",
				timestamp: "2026-07-20T09:00:01.000Z",
				type: "user",
				content: "from jsonl",
			}),
		].join("\n"),
		"utf-8",
	);
	writeFileSync(
		jsonPath,
		JSON.stringify({
			sessionId: "dup-session",
			messages: [
				{
					id: "d1",
					timestamp: "2026-07-20T09:00:01.000Z",
					type: "user",
					content: "from json",
				},
			],
		}),
		"utf-8",
	);

	// Make the legacy snapshot newer than the log.
	const older = new Date("2026-07-20T09:00:10.000Z");
	const newer = new Date("2026-07-20T09:01:00.000Z");
	utimesSync(jsonlPath, older, older);
	utimesSync(jsonPath, newer, newer);

	const metas = await geminiAdapter.scan();
	assert.equal(metas.length, 1);
	const meta = findMeta(metas, "dup-session");
	assert.equal(meta.filePath, jsonPath);
	assert.equal(meta.fileMtime, newer.toISOString());

	const parsed = await geminiAdapter.parse(meta);
	assert.equal(parsed.messages[0].content, "from json");
});

test("reads the project registry to map a project id back to its cwd", async () => {
	resetFixtureRoot();
	writeJsonFixture("projects.json", {
		projects: {
			"/home/fixture/registry-app": "registry-project",
			"/home/fixture/other-app": "other-project",
		},
	});
	writeFixture(
		join(
			"tmp",
			"registry-project",
			"chats",
			"session-2026-07-21T09-00-registry.json",
		),
		JSON.stringify({
			sessionId: "registry-session",
			messages: [
				{
					id: "r1",
					timestamp: "2026-07-21T09:00:01.000Z",
					type: "user",
					content: "hi",
				},
			],
		}),
	);

	const metas = await geminiAdapter.scan();
	const meta = findMeta(metas, "registry-session");
	assert.equal(meta.projectDir, "/home/fixture/registry-app");
	const parsed = await geminiAdapter.parse(meta);
	assert.equal(parsed.projectName, "registry-app");
});

test("tolerates corrupt session files without throwing", async () => {
	resetFixtureRoot();
	writeFixture(
		join("tmp", "broken-project", "chats", "session-2026-07-22T09-00-broken.json"),
		"{ this is not valid json",
	);

	// A corrupt snapshot still yields metadata with the filename fallback id and
	// parses to an empty conversation instead of failing the import batch.
	const metas = await geminiAdapter.scan();
	assert.equal(metas.length, 1);
	const meta = metas[0];
	assert.equal(meta.id, "session-2026-07-22T09-00-broken");
	assert.equal(meta.projectDir, "");
	const parsed = await geminiAdapter.parse(meta);
	assert.equal(parsed.id, meta.id);
	assert.equal(parsed.projectName, "Gemini");
	assert.deepEqual(parsed.messages, []);
});

test("detect, scan and parse include sessions from a WSL distro home", async () => {
	resetFixtureRoot();
	// A session in the local Gemini home.
	writeProjectRootMarker("local-project", "/home/fixture/local-app");
	writeJsonFixture(
		join("tmp", "local-project", "chats", "session-2026-08-03T09-00-local.json"),
		{
			sessionId: "local-gemini-session",
			messages: [
				{
					id: "l1",
					timestamp: "2026-08-03T09:00:01.000Z",
					type: "user",
					content: "local question",
				},
			],
		},
	);
	// A session in the WSL distro home, at the same `<home>/.gemini` layout.
	writeWslFixture(join("tmp", "wsl-project", ".project_root"), "/home/wsl-user/code/wsl-app");
	const wslFile = writeWslFixture(
		join("tmp", "wsl-project", "chats", "session-2026-08-03T10-00-wsl.json"),
		JSON.stringify({
			sessionId: "wsl-gemini-session",
			startTime: "2026-08-03T10:00:00.000Z",
			messages: [
				{
					id: "w1",
					timestamp: "2026-08-03T10:00:01.000Z",
					type: "user",
					content: "wsl question",
				},
				{
					id: "w2",
					timestamp: "2026-08-03T10:00:02.000Z",
					type: "gemini",
					content: "wsl answer",
				},
			],
		}),
	);

	setWslHomesForTesting([wslHome]);
	try {
		const info = await geminiAdapter.detect();
		assert.ok(info);
		assert.equal(info.dataDir, fixtureRoot);
		// One conversation locally plus one inside the WSL distro home.
		assert.equal(info.conversationCount, 2);

		const metas = await geminiAdapter.scan();
		assert.equal(metas.length, 2);
		const local = findMeta(metas, "local-gemini-session");
		assert.equal(local.rootDir, fixtureRoot);
		const wsl = findMeta(metas, "wsl-gemini-session");
		assert.equal(wsl.rootDir, wslRoot);
		assert.equal(wsl.filePath, wslFile);
		assert.ok(wsl.filePath.startsWith(wslHome));
		// The per-project `.project_root` marker is read from the WSL root.
		assert.equal(wsl.projectDir, "/home/wsl-user/code/wsl-app");

		const parsed = await geminiAdapter.parse(wsl);
		assert.equal(parsed.id, "wsl-gemini-session");
		assert.equal(parsed.cwd, "/home/wsl-user/code/wsl-app");
		assert.deepEqual(
			parsed.messages.map((message) => [message.type, message.content]),
			[
				["user", "wsl question"],
				["assistant", "wsl answer"],
			],
		);

		// WSL roots are not watched: the watcher only tracks local Windows paths.
		const watched = geminiAdapter.watchPaths?.() ?? [];
		for (const path of watched) assert.ok(!path.startsWith(wslHome));
	} finally {
		setWslHomesForTesting(null);
	}
});

test("watchPaths points at the chats tree", async () => {
	resetFixtureRoot();
	const paths = geminiAdapter.watchPaths?.() ?? [];
	assert.equal(paths.length, 1);
	assert.ok(paths[0].includes("tmp"));
	assert.ok(paths[0].includes("**"));
});
