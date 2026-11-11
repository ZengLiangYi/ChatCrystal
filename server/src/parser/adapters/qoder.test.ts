import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

// The adapter reads its data folder from appConfig, which is populated when the
// config module is first imported. Point the env var at a fixture root before
// importing the adapter.
const fixtureRoot = mkdtempSync(join(tmpdir(), "chatcrystal-qoder-"));
const wslHome = mkdtempSync(join(tmpdir(), "chatcrystal-qoder-wsl-home-"));
const wslRoot = join(wslHome, ".qoder");
process.env.QODER_CONFIG_DIR = fixtureRoot;
// Keep the developer's real WSL distros out of these fixtures; the WSL test
// injects its own home through setWslHomesForTesting().
process.env.CHATCRYSTAL_WSL = "0";

const { qoderAdapter } = await import("./qoder.js");
const { setWslHomesForTesting } = await import("../wsl.js");

const MANGLED_PROJECT = "C--Users-fixture-code-app";
const CWD = "C:\\Users\\fixture\\code\\app";

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

function claudeLine(options: {
	uuid: string;
	parentUuid?: string | null;
	type: "user" | "assistant";
	content: string | Array<Record<string, unknown>>;
	cwd: string;
	timestamp: string;
}): string {
	return JSON.stringify({
		uuid: options.uuid,
		parentUuid: options.parentUuid ?? null,
		type: options.type,
		sessionId: "session-one",
		cwd: options.cwd,
		timestamp: options.timestamp,
		message: { role: options.type, content: options.content },
	});
}

function findMeta(
	metas: Awaited<ReturnType<typeof qoderAdapter.scan>>,
	id: string,
) {
	const meta = metas.find((item) => item.id === id);
	assert.ok(meta, `expected scanned conversation ${id}`);
	return meta;
}

test("detect returns null and scan is empty when no sessions exist", async () => {
	resetFixtureRoot();
	assert.equal(await qoderAdapter.detect(), null);
	assert.deepEqual(await qoderAdapter.scan(), []);
});

test("parses a Claude-style Qoder transcript and recovers its title", async () => {
	resetFixtureRoot();

	const filePath = writeJsonlFixture(
		fixtureRoot,
		join("projects", MANGLED_PROJECT, "session-one.jsonl"),
		[
			claudeLine({
				uuid: "u1",
				type: "user",
				content: "Why does the parser drop my prompt?",
				cwd: CWD,
				timestamp: "2026-08-01T09:00:01.000Z",
			}),
			"this line is not JSON and must be skipped",
			claudeLine({
				uuid: "a1",
				parentUuid: "u1",
				type: "assistant",
				content: [
					{
						type: "thinking",
						thinking: "I should check how JSONL lines are parsed.",
					},
					{ type: "text", text: "Let me look at the reader." },
					{ type: "tool_use", id: "tool-1", name: "Read", input: {} },
					{ type: "text", text: "The last line was malformed." },
				],
				cwd: CWD,
				timestamp: "2026-08-01T09:00:02.000Z",
			}),
			{ type: "ai-title", aiTitle: "Generated title", sessionId: "session-one" },
			{ type: "custom-title", customTitle: "User title", sessionId: "session-one" },
		],
	);
	// The subagent transcript lives below <id>/subagents/.
	writeJsonlFixture(
		fixtureRoot,
		join("projects", MANGLED_PROJECT, "session-one", "subagents", "agent-1.jsonl"),
		[
			claudeLine({
				uuid: "s2",
				type: "user",
				content: "subagent work",
				cwd: CWD,
				timestamp: "2026-08-01T09:00:04.000Z",
			}),
		],
	);

	const info = await qoderAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "qoder");
	assert.equal(info.displayName, "Qoder");
	assert.equal(info.dataDir, fixtureRoot);
	assert.equal(info.conversationCount, 1);

	const metas = await qoderAdapter.scan();
	assert.equal(metas.length, 1);
	const meta = findMeta(metas, "session-one");
	assert.equal(meta.source, "qoder");
	assert.equal(meta.filePath, filePath);
	assert.equal(meta.projectDir, MANGLED_PROJECT);
	assert.equal(meta.rootDir, fixtureRoot);
	assert.ok(meta.fileSize > 0);
	assert.ok(!Number.isNaN(Date.parse(meta.fileMtime)));

	const parsed = await qoderAdapter.parse(meta);
	assert.equal(parsed.id, "session-one");
	assert.equal(parsed.source, "qoder");
	// The custom title wins over the generated ai-title.
	assert.equal(parsed.slug, "User title");
	assert.equal(parsed.cwd, CWD);
	assert.equal(parsed.projectName, "code-app");

	assert.deepEqual(
		parsed.messages.map((message) => [message.type, message.content]),
		[
			["user", "Why does the parser drop my prompt?"],
			["assistant", "Let me look at the reader.\nThe last line was malformed."],
		],
	);
	assert.equal(
		parsed.messages[1]?.thinking,
		"I should check how JSONL lines are parsed.",
	);
	assert.equal(parsed.messages[1]?.hasToolUse, true);
	assert.equal(parsed.messages[1]?.timestamp, "2026-08-01T09:00:02.000Z");
	assert.equal(parsed.firstMessageAt, "2026-08-01T09:00:01.000Z");
	assert.equal(parsed.lastMessageAt, "2026-08-01T09:00:02.000Z");
});

test("falls back to the ai-title when the transcript has no slug or custom title", async () => {
	resetFixtureRoot();
	writeJsonlFixture(
		fixtureRoot,
		join("projects", "-home-fixture-mangled", "plain-title-session.jsonl"),
		[
			claudeLine({
				uuid: "p1",
				type: "user",
				content: "hello",
				cwd: "/home/fixture/mangled",
				timestamp: "2026-08-02T10:00:01.000Z",
			}),
			claudeLine({
				uuid: "p2",
				parentUuid: "p1",
				type: "assistant",
				content: "hi there",
				cwd: "/home/fixture/mangled",
				timestamp: "2026-08-02T10:00:02.000Z",
			}),
			{ type: "ai-title", aiTitle: "Generated title", sessionId: "plain-title-session" },
		],
	);

	const meta = (await qoderAdapter.scan())[0];
	assert.ok(meta);
	const parsed = await qoderAdapter.parse(meta);
	assert.equal(parsed.slug, "Generated title");
	assert.equal(parsed.projectName, "fixture-mangled");
});

test("tolerates transcripts that contain only corrupt lines", async () => {
	resetFixtureRoot();
	writeFixture(
		fixtureRoot,
		join("projects", "-tmp-broken", "broken-session.jsonl"),
		"not json at all\n{\"partial\":",
	);

	const metas = await qoderAdapter.scan();
	assert.equal(metas.length, 1);
	const meta = metas[0];
	assert.ok(meta);
	assert.equal(meta.id, "broken-session");
	const parsed = await qoderAdapter.parse(meta);
	assert.equal(parsed.id, "broken-session");
	assert.equal(parsed.source, "qoder");
	assert.deepEqual(parsed.messages, []);
	assert.equal(parsed.slug, null);
	assert.equal(parsed.projectName, "tmp-broken");
	assert.ok(!Number.isNaN(Date.parse(parsed.firstMessageAt)));
});

test("detect, scan and parse include sessions from a WSL distro home", async () => {
	resetFixtureRoot();
	writeJsonlFixture(
		fixtureRoot,
		join("projects", "-home-fixture-local-app", "local-session.jsonl"),
		[
			claudeLine({
				uuid: "l1",
				type: "user",
				content: "local question",
				cwd: "/home/fixture/local-app",
				timestamp: "2026-08-04T09:00:01.000Z",
			}),
		],
	);
	const wslFile = writeJsonlFixture(
		wslRoot,
		join("projects", "-home-wsl-user-code-wsl-app", "wsl-session.jsonl"),
		[
			claudeLine({
				uuid: "w1",
				type: "user",
				content: "wsl question",
				cwd: "/home/wsl-user/code/wsl-app",
				timestamp: "2026-08-04T10:00:01.000Z",
			}),
			claudeLine({
				uuid: "w2",
				parentUuid: "w1",
				type: "assistant",
				content: "wsl answer",
				cwd: "/home/wsl-user/code/wsl-app",
				timestamp: "2026-08-04T10:00:02.000Z",
			}),
		],
	);

	setWslHomesForTesting([wslHome]);
	try {
		const info = await qoderAdapter.detect();
		assert.ok(info);
		assert.equal(info.dataDir, fixtureRoot);
		// One conversation locally plus one inside the WSL distro home.
		assert.equal(info.conversationCount, 2);

		const metas = await qoderAdapter.scan();
		assert.equal(metas.length, 2);
		const local = findMeta(metas, "local-session");
		assert.equal(local.rootDir, fixtureRoot);
		const wsl = findMeta(metas, "wsl-session");
		assert.equal(wsl.rootDir, wslRoot);
		assert.equal(wsl.filePath, wslFile);
		assert.ok(wsl.filePath.startsWith(wslHome));

		const parsed = await qoderAdapter.parse(wsl);
		assert.equal(parsed.id, "wsl-session");
		assert.equal(parsed.source, "qoder");
		assert.equal(parsed.cwd, "/home/wsl-user/code/wsl-app");
		assert.equal(parsed.projectName, "wsl-app");
		assert.deepEqual(
			parsed.messages.map((message) => [message.type, message.content]),
			[
				["user", "wsl question"],
				["assistant", "wsl answer"],
			],
		);

		// WSL roots are not watched: the watcher only tracks local Windows paths.
		const watched = qoderAdapter.watchPaths?.() ?? [];
		for (const path of watched) assert.ok(!path.startsWith(wslHome));
	} finally {
		setWslHomesForTesting(null);
	}
});

test("watchPaths points at the local projects tree", () => {
	resetFixtureRoot();
	const paths = qoderAdapter.watchPaths?.() ?? [];
	assert.equal(paths.length, 1);
	assert.ok(paths[0]?.includes("projects"));
	assert.ok(paths[0]?.includes("**"));
});
