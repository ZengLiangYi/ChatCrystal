import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";

// The adapter reads its data folder from appConfig, which is populated when the
// config module is first imported. Point the env var at a fixture root before
// importing the adapter.
const fixtureRoot = mkdtempSync(join(tmpdir(), "chatcrystal-claude-desktop-"));
process.env.CLAUDE_DESKTOP_DATA_DIR = fixtureRoot;
process.env.CHATCRYSTAL_WSL = "0";

const { claudeDesktopAdapter } = await import("./claude-desktop.js");

after(() => {
	rmSync(fixtureRoot, { recursive: true, force: true });
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

function writeJsonlFixture(relativePath: string, lines: unknown[]): string {
	return writeFixture(
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
	content: string;
	cwd: string;
	timestamp: string;
}): string {
	return JSON.stringify({
		uuid: options.uuid,
		parentUuid: options.parentUuid ?? null,
		type: options.type,
		sessionId: "desktop-session",
		cwd: options.cwd,
		timestamp: options.timestamp,
		message: { role: options.type, content: options.content },
	});
}

interface CoworkSessionOptions {
	account: string;
	org: string;
	localId: string;
	projectFolder: string;
	sessionId: string;
	lines: unknown[];
	/** Desktop metadata written next to the local_<id> folder. */
	metadata?: Record<string, unknown>;
}

function writeCoworkSession(options: CoworkSessionOptions): string {
	const filePath = writeJsonlFixture(
		join(
			"local-agent-mode-sessions",
			options.account,
			options.org,
			options.localId,
			".claude",
			"projects",
			options.projectFolder,
			`${options.sessionId}.jsonl`,
		),
		options.lines,
	);
	if (options.metadata) {
		writeFixture(
			join(
				"local-agent-mode-sessions",
				options.account,
				options.org,
				`${options.localId}.json`,
			),
			JSON.stringify(options.metadata),
		);
	}
	return filePath;
}

interface CodeStoreSessionOptions {
	account: string;
	org: string;
	localId: string;
	projectFolder: string;
	sessionId: string;
	lines: unknown[];
	metadata?: Record<string, unknown>;
}

/** A transcript tree under Desktop's other per-account store. */
function writeCodeStoreSession(options: CodeStoreSessionOptions): string {
	const filePath = writeJsonlFixture(
		join(
			"claude-code-sessions",
			options.account,
			options.org,
			options.localId,
			".claude",
			"projects",
			options.projectFolder,
			`${options.sessionId}.jsonl`,
		),
		options.lines,
	);
	if (options.metadata) {
		writeFixture(
			join(
				"claude-code-sessions",
				options.account,
				options.org,
				`${options.localId}.json`,
			),
			JSON.stringify(options.metadata),
		);
	}
	return filePath;
}

function findMeta(
	metas: Awaited<ReturnType<typeof claudeDesktopAdapter.scan>>,
	id: string,
) {
	const meta = metas.find((item) => item.id === id);
	assert.ok(meta, `expected scanned conversation ${id}`);
	return meta;
}

test("detect returns null and scan is empty when no session tree exists", async () => {
	resetFixtureRoot();
	assert.equal(await claudeDesktopAdapter.detect(), null);
	assert.deepEqual(await claudeDesktopAdapter.scan(), []);

	// Metadata only (`local_*.json`) is not a conversation transcript.
	writeFixture(
		join("local-agent-mode-sessions", "account", "org", "local_empty.json"),
		JSON.stringify({ sessionId: "local_empty", title: "No transcript yet" }),
	);
	writeFixture(
		join("claude-code-sessions", "account", "org", "scheduled-tasks.json"),
		"[]",
	);
	assert.equal(await claudeDesktopAdapter.detect(), null);
});

test("discovers both Claude Desktop session stores and parses their transcripts", async () => {
	resetFixtureRoot();

	const coworkPath = writeCoworkSession({
		account: "dcda8f06",
		org: "378f01f9",
		localId: "local_cowork",
		projectFolder: "C--Users-fixture-code-cowork",
		sessionId: "cowork-session",
		lines: [
			claudeLine({
				uuid: "u1",
				type: "user",
				content: "Plan the Cowork session",
				cwd: "C:\\Users\\fixture\\code\\cowork",
				timestamp: "2026-08-05T09:00:01.000Z",
			}),
			claudeLine({
				uuid: "a1",
				parentUuid: "u1",
				type: "assistant",
				content: "Here is the plan.",
				cwd: "C:\\Users\\fixture\\code\\cowork",
				timestamp: "2026-08-05T09:00:02.000Z",
			}),
		],
		metadata: {
			sessionId: "local_cowork",
			cliSessionId: "cowork-session",
			title: "Cowork planning",
		},
	});

	const codePath = writeCodeStoreSession({
		account: "dcda8f06",
		org: "378f01f9",
		localId: "local_code",
		projectFolder: "-home-fixture-code-mode",
		sessionId: "code-session",
		lines: [
			claudeLine({
				uuid: "c1",
				type: "user",
				content: "Explain the code path",
				cwd: "/home/fixture/code/mode",
				timestamp: "2026-08-05T10:00:01.000Z",
			}),
			claudeLine({
				uuid: "c2",
				parentUuid: "c1",
				type: "assistant",
				content: "The code path is straightforward.",
				cwd: "/home/fixture/code/mode",
				timestamp: "2026-08-05T10:00:02.000Z",
			}),
			{
				type: "ai-title",
				aiTitle: "Code mode title",
				sessionId: "code-session",
			},
		],
	});

	// Subagent transcripts are not main conversations.
	writeJsonlFixture(
		join(
			"local-agent-mode-sessions",
			"dcda8f06",
			"378f01f9",
			"local_cowork",
			".claude",
			"projects",
			"C--Users-fixture-code-cowork",
			"cowork-session",
			"subagents",
			"agent-1.jsonl",
		),
		[
			claudeLine({
				uuid: "s1",
				type: "user",
				content: "subagent task",
				cwd: "C:\\Users\\fixture\\code\\cowork",
				timestamp: "2026-08-05T09:00:03.000Z",
			}),
		],
	);

	const info = await claudeDesktopAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "claude-desktop");
	assert.equal(info.displayName, "Claude Desktop");
	assert.equal(info.dataDir, fixtureRoot);
	assert.equal(info.conversationCount, 2);

	const metas = await claudeDesktopAdapter.scan();
	assert.equal(metas.length, 2);

	const cowork = findMeta(metas, "cowork-session");
	assert.equal(cowork.source, "claude-desktop");
	assert.equal(cowork.filePath, coworkPath);
	assert.equal(cowork.rootDir, fixtureRoot);
	assert.equal(cowork.projectDir, "C--Users-fixture-code-cowork");

	const code = findMeta(metas, "code-session");
	assert.equal(code.filePath, codePath);

	const coworkParsed = await claudeDesktopAdapter.parse(cowork);
	assert.equal(coworkParsed.id, "cowork-session");
	assert.equal(coworkParsed.source, "claude-desktop");
	// The Desktop metadata name is used when the transcript has no title.
	assert.equal(coworkParsed.slug, "Cowork planning");
	assert.equal(coworkParsed.cwd, "C:\\Users\\fixture\\code\\cowork");
	assert.equal(coworkParsed.projectName, "code-cowork");
	assert.deepEqual(
		coworkParsed.messages.map((message) => [message.type, message.content]),
		[
			["user", "Plan the Cowork session"],
			["assistant", "Here is the plan."],
		],
	);

	const codeParsed = await claudeDesktopAdapter.parse(code);
	assert.equal(codeParsed.id, "code-session");
	assert.equal(codeParsed.source, "claude-desktop");
	assert.equal(codeParsed.slug, "Code mode title");
	assert.equal(codeParsed.cwd, "/home/fixture/code/mode");
	assert.equal(codeParsed.projectName, "code-mode");
	assert.deepEqual(
		codeParsed.messages.map((message) => message.type),
		["user", "assistant"],
	);
});

test("matches Desktop metadata whose sessionId carries the local_ prefix", async () => {
	resetFixtureRoot();
	writeCoworkSession({
		account: "account",
		org: "workspace",
		localId: "local_prefixed",
		projectFolder: "C--Users-fixture-prefixed",
		sessionId: "plain-uuid-session",
		lines: [
			claudeLine({
				uuid: "p1",
				type: "user",
				content: "hello",
				cwd: "C:\\Users\\fixture\\prefixed",
				timestamp: "2026-08-06T09:00:01.000Z",
			}),
		],
		metadata: {
			// No cliSessionId: the transcript runs under the stripped sessionId.
			sessionId: "local_plain-uuid-session",
			title: "Prefixed metadata title",
		},
	});

	const meta = (await claudeDesktopAdapter.scan())[0];
	assert.ok(meta);
	const parsed = await claudeDesktopAdapter.parse(meta);
	assert.equal(parsed.slug, "Prefixed metadata title");
});

test("tolerates transcripts that contain only corrupt lines", async () => {
	resetFixtureRoot();
	writeFixture(
		join(
			"local-agent-mode-sessions",
			"account",
			"org",
			"local_broken",
			".claude",
			"projects",
			"-tmp-broken",
			"broken-session.jsonl",
		),
		"not json at all\n{\"partial\":",
	);

	const metas = await claudeDesktopAdapter.scan();
	assert.equal(metas.length, 1);
	const meta = metas[0];
	assert.ok(meta);
	assert.equal(meta.id, "broken-session");
	const parsed = await claudeDesktopAdapter.parse(meta);
	assert.equal(parsed.id, "broken-session");
	assert.equal(parsed.source, "claude-desktop");
	assert.deepEqual(parsed.messages, []);
	assert.equal(parsed.slug, null);
	assert.equal(parsed.projectName, "tmp-broken");
});

test("watchPaths only returns local session stores", () => {
	resetFixtureRoot();
	const paths = claudeDesktopAdapter.watchPaths?.() ?? [];
	assert.equal(paths.length, 2);
	for (const path of paths) {
		assert.ok(path.startsWith(fixtureRoot));
		assert.ok(!path.startsWith("\\\\"));
	}
	assert.ok(paths.some((path) => path.includes("local-agent-mode-sessions")));
	assert.ok(paths.some((path) => path.includes("claude-code-sessions")));
	assert.deepEqual(
		paths,
		[
			resolve(fixtureRoot, "local-agent-mode-sessions", "**", "*.jsonl"),
			resolve(fixtureRoot, "claude-code-sessions", "**", "*.jsonl"),
		],
	);
});
