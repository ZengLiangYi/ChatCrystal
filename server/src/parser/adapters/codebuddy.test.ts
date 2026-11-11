import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

// The adapter reads its data folder from appConfig, which is populated when the
// config module is first imported. Point the env var at a fixture root before
// importing the adapter.
const fixtureRoot = mkdtempSync(join(tmpdir(), "chatcrystal-codebuddy-"));
const wslHome = mkdtempSync(join(tmpdir(), "chatcrystal-codebuddy-wsl-home-"));
const wslRoot = join(wslHome, ".codebuddy");
process.env.CODEBUDDY_CONFIG_DIR = fixtureRoot;
// Keep the developer's real WSL distros out of these fixtures; the WSL test
// injects its own home through setWslHomesForTesting().
process.env.CHATCRYSTAL_WSL = "0";

const { codebuddyAdapter } = await import("./codebuddy.js");
const { setWslHomesForTesting } = await import("../wsl.js");

const MANGLED_PROJECT = "c-Users-fixture-repo-demo";
const CWD = "c:\\Users\\fixture\\repo\\demo";
const SESSION_ID = "inner-buddy-session";
const BASE_TIME = 1793765860947;

after(() => {
	setWslHomesForTesting(null);
	rmSync(fixtureRoot, { recursive: true, force: true });
	rmSync(wslHome, { recursive: true, force: true });
});

function resetFixtureRoot(): void {
	rmSync(fixtureRoot, { recursive: true, force: true });
	mkdirSync(fixtureRoot, { recursive: true });
}

function writeFixture(
	root: string,
	relativePath: string,
	content: string,
): string {
	const filePath = join(root, relativePath);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, content, "utf-8");
	return filePath;
}

function writeJsonlFixture(
	root: string,
	relativePath: string,
	lines: unknown[],
): string {
	return writeFixture(
		root,
		relativePath,
		`${lines
			.map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
			.join("\n")}\n`,
	);
}

function sessionMetaLine(sessionId: string): string {
	return JSON.stringify({
		type: "session-meta",
		id: "01a1a4c6-fc84-794b-b575-a9b8cd6a4526",
		sessionId,
		timestamp: BASE_TIME - 1000,
		meta: { "codebuddy.ai/hostKind": "unopted" },
	});
}

test("detect returns null and scan is empty when no sessions exist", async () => {
	resetFixtureRoot();
	assert.equal(await codebuddyAdapter.detect(), null);
	assert.deepEqual(await codebuddyAdapter.scan(), []);
});

test("parses a WorkBuddy-style CodeBuddy session and overrides the source", async () => {
	resetFixtureRoot();

	// The file name normally equals the session id; the id inside the file wins
	// so scan and parse agree on the conversation id.
	const filePath = writeJsonlFixture(
		fixtureRoot,
		join("projects", MANGLED_PROJECT, "renamed-file.jsonl"),
		[
			sessionMetaLine(SESSION_ID),
			{
				id: "m-user-1",
				timestamp: BASE_TIME + 100,
				type: "message",
				role: "user",
				content: [
					{
						type: "input_text",
						text: [
							'<system-reminder data-role="user-context">',
							"OS Version: win32",
							"</system-reminder>",
							"<user_query>Refactor the parser</user_query>",
						].join("\n"),
					},
				],
				cwd: CWD,
				sessionId: SESSION_ID,
			},
			{
				id: "m-reasoning-1",
				parentId: "m-user-1",
				timestamp: BASE_TIME + 200,
				type: "reasoning",
				content: [],
				rawContent: [
					{ type: "reasoning_text", text: "Inspect the parser first." },
				],
				cwd: CWD,
				sessionId: SESSION_ID,
			},
			{
				id: "m-assistant-1",
				timestamp: BASE_TIME + 300,
				type: "message",
				role: "assistant",
				content: [
					{
						type: "output_text",
						text: "Here is the plan:\n```ts\nconst a = 1;\n```",
					},
				],
				cwd: CWD,
				sessionId: SESSION_ID,
			},
			{
				id: "m-call-1",
				timestamp: BASE_TIME + 400,
				type: "function_call",
				name: "Read",
				arguments: "{}",
				cwd: CWD,
				sessionId: SESSION_ID,
			},
			{
				id: "m-title-ai",
				timestamp: BASE_TIME + 500,
				type: "ai-title",
				aiTitle: "Refactor plan",
				cwd: CWD,
				sessionId: SESSION_ID,
			},
			'{"id":"m-truncated","timestamp":179376586',
		],
	);

	// Subagent transcripts and side files are not main conversations.
	writeJsonlFixture(
		fixtureRoot,
		join("projects", MANGLED_PROJECT, SESSION_ID, "subagents", "agent-1.jsonl"),
		[sessionMetaLine(SESSION_ID)],
	);
	writeFileSync(
		join(fixtureRoot, "projects", MANGLED_PROJECT, `${SESSION_ID}.meta.json`),
		JSON.stringify({ cwd: CWD }),
	);

	const info = await codebuddyAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "codebuddy");
	assert.equal(info.displayName, "CodeBuddy");
	assert.equal(info.dataDir, fixtureRoot);
	assert.equal(info.conversationCount, 1);

	const metas = await codebuddyAdapter.scan();
	assert.equal(metas.length, 1);
	const meta = metas[0];
	assert.ok(meta);
	assert.equal(meta.id, SESSION_ID);
	assert.equal(meta.source, "codebuddy");
	assert.equal(meta.filePath, filePath);
	assert.equal(meta.projectDir, MANGLED_PROJECT);
	assert.equal(meta.rootDir, fixtureRoot);
	assert.ok(meta.fileSize > 0);
	assert.ok(!Number.isNaN(Date.parse(meta.fileMtime)));

	const parsed = await codebuddyAdapter.parse(meta);
	// Contract: parse() keeps the scanned conversation id.
	assert.equal(parsed.id, SESSION_ID);
	assert.equal(parsed.source, "codebuddy");
	assert.equal(parsed.slug, "Refactor plan");
	assert.equal(parsed.cwd, CWD);
	assert.equal(parsed.projectName, "demo");

	assert.deepEqual(
		parsed.messages.map((message) => message.type),
		["user", "assistant"],
	);
	const [userMessage, assistantMessage] = parsed.messages;
	assert.ok(userMessage && assistantMessage);
	assert.equal(userMessage.content, "Refactor the parser");
	assert.equal(assistantMessage.thinking, "Inspect the parser first.");
	assert.equal(assistantMessage.hasToolUse, true);
	assert.equal(assistantMessage.hasCode, true);
	assert.equal(
		assistantMessage.content,
		"Here is the plan:\n```ts\nconst a = 1;\n```",
	);
	assert.equal(parsed.firstMessageAt, new Date(BASE_TIME + 100).toISOString());
	assert.equal(
		parsed.lastMessageAt,
		new Date(BASE_TIME + 300).toISOString(),
	);
});

test("tolerates a session file that contains only corrupt lines", async () => {
	resetFixtureRoot();
	writeFixture(
		fixtureRoot,
		join("projects", "-tmp-broken-buddy", "broken-session.jsonl"),
		"not json at all\n{\"partial\":",
	);

	const metas = await codebuddyAdapter.scan();
	assert.equal(metas.length, 1);
	const meta = metas[0];
	assert.ok(meta);
	// No readable sessionId: the file name is the fallback id.
	assert.equal(meta.id, "broken-session");
	const parsed = await codebuddyAdapter.parse(meta);
	assert.equal(parsed.id, "broken-session");
	assert.equal(parsed.source, "codebuddy");
	assert.deepEqual(parsed.messages, []);
	assert.equal(parsed.slug, null);
});

test("detect, scan and parse include sessions from a WSL distro home", async () => {
	resetFixtureRoot();
	writeJsonlFixture(
		fixtureRoot,
		join("projects", "-home-fixture-local-demo", "local-session.jsonl"),
		[
			sessionMetaLine("local-session"),
			{
				id: "l-user",
				timestamp: BASE_TIME + 100,
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "local question" }],
				cwd: "/home/fixture/local-demo",
			},
		],
	);
	const wslFile = writeJsonlFixture(
		wslRoot,
		join("projects", "-home-wsl-user-code-wsl-demo", "wsl-session.jsonl"),
		[
			sessionMetaLine("wsl-session"),
			{
				id: "w-user",
				timestamp: BASE_TIME + 100,
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "wsl question" }],
				cwd: "/home/wsl-user/code/wsl-demo",
			},
			{
				id: "w-assistant",
				timestamp: BASE_TIME + 200,
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "wsl answer" }],
				cwd: "/home/wsl-user/code/wsl-demo",
			},
		],
	);

	setWslHomesForTesting([wslHome]);
	try {
		const info = await codebuddyAdapter.detect();
		assert.ok(info);
		assert.equal(info.dataDir, fixtureRoot);
		assert.equal(info.conversationCount, 2);

		const metas = await codebuddyAdapter.scan();
		assert.equal(metas.length, 2);
		const wsl = metas.find((meta) => meta.id === "wsl-session");
		assert.ok(wsl);
		assert.equal(wsl.rootDir, wslRoot);
		assert.equal(wsl.filePath, wslFile);
		assert.ok(wsl.filePath.startsWith(wslHome));

		const parsed = await codebuddyAdapter.parse(wsl);
		assert.equal(parsed.id, "wsl-session");
		assert.equal(parsed.source, "codebuddy");
		assert.equal(parsed.cwd, "/home/wsl-user/code/wsl-demo");
		assert.equal(parsed.projectName, "wsl-demo");
		assert.deepEqual(
			parsed.messages.map((message) => [message.type, message.content]),
			[
				["user", "wsl question"],
				["assistant", "wsl answer"],
			],
		);

		// WSL roots are not watched: the watcher only tracks local Windows paths.
		const watched = codebuddyAdapter.watchPaths?.() ?? [];
		for (const path of watched) assert.ok(!path.startsWith(wslHome));
	} finally {
		setWslHomesForTesting(null);
	}
});

test("watchPaths points at the local projects tree", () => {
	resetFixtureRoot();
	const paths = codebuddyAdapter.watchPaths?.() ?? [];
	assert.equal(paths.length, 1);
	assert.ok(paths[0]?.includes("projects"));
});
