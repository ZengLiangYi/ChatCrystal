import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

// ---------------------------------------------------------------------------
// Self-contained fixture: a fake MiniMax Code home under a temp dir. The home
// env var must be set before the adapter (and appConfig) is imported.
// ---------------------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), "chatcrystal-minimax-test-"));
const minimaxDir = join(root, "minimax-home");

process.env.DATA_DIR = join(root, "data");
process.env.MINIMAX_DATA_DIR = minimaxDir;
// A real WSL distro may be running on this machine; keep it out of the tests.
process.env.CHATCRYSTAL_WSL = "0";

const { minimaxCodeAdapter } = await import("./minimax-code.js");
const { setWslHomesForTesting } = await import("../wsl.js");

after(() => {
	setWslHomesForTesting(null);
	rmSync(root, { recursive: true, force: true });
});

function writeLines(filePath: string, lines: string[]): void {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${lines.join("\n")}\n`, "utf-8");
}

function normalizePath(filePath: string): string {
	return filePath.replace(/\\/g, "/");
}

const BASE_MS = Date.UTC(2026, 9, 11, 11, 16, 17);
const SESSION_ONE = "mvs_test_session_one";
const SESSION_TWO = "mvs_test_session_two";
const SESSION_DIR_SUFFIX = "session_";

/** A session folder name: `<hh-mm-ss-ms>-session_<base64 of the session id>`. */
function sessionDirName(sessionId: string): string {
	const encoded = Buffer.from(sessionId, "utf-8").toString("base64url");
	return `11-16-16-553-${SESSION_DIR_SUFFIX}${encoded}`;
}

function messagesPathFor(
	rootDir: string,
	sessionId: string,
	fileName = "messages.jsonl",
): string {
	return join(
		rootDir,
		"v2",
		"sessions",
		"2026",
		"10",
		"11",
		sessionDirName(sessionId),
		fileName,
	);
}

interface LineOptions {
	messageId: string;
	role: string;
	content: unknown;
	timestamp: number;
	extra?: Record<string, unknown>;
}

function messageLine(options: LineOptions): string {
	return JSON.stringify({
		message_id: options.messageId,
		turn_id: "turn-1",
		message: {
			role: options.role,
			content: options.content,
			timestamp: options.timestamp,
			...options.extra,
		},
	});
}

let fixturesReady = false;

function ensureFixtures(): void {
	if (fixturesReady) return;
	fixturesReady = true;
	createSessionOne();
	createSessionTwo();
}

/** A session with injected context, a tool call and an older generation. */
function createSessionOne(): void {
	const injectedText = [
		"<system-reminder>",
		"<agent-context>injected app context</agent-context>",
		"</system-reminder>",
		"",
		"Say pong",
	].join("\n");
	const genuineStart = injectedText.indexOf("Say pong");

	writeLines(messagesPathFor(minimaxDir, SESSION_ONE), [
		messageLine({
			messageId: "msg-u1",
			role: "user",
			content: [{ type: "text", text: injectedText }],
			timestamp: BASE_MS,
			// The app records where the text the person typed is.
			extra: {
				canonicalTextRange: {
					startOffset: genuineStart,
					endOffset: genuineStart + "Say pong".length,
				},
			},
		}),
		messageLine({
			messageId: "msg-a1",
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "Just answer." },
				{ type: "text", text: "pong" },
				{ type: "toolCall", id: "call-1", name: "Bash", arguments: {} },
			],
			timestamp: BASE_MS + 100,
			extra: { provider: "custom_provider:relay", model: "m1" },
		}),
		messageLine({
			messageId: "msg-u2",
			role: "user",
			content: [
				{
					type: "text",
					text: "<system-reminder>more injected context</system-reminder>Second question",
				},
			],
			timestamp: BASE_MS + 200,
			extra: { genuineUserQueryText: "Second question" },
		}),
		messageLine({
			messageId: "msg-a2",
			role: "assistant",
			content: [{ type: "text", text: "answer two" }],
			timestamp: BASE_MS + 300,
		}),
		// Tool results and host bookkeeping are not user/assistant turns.
		messageLine({
			messageId: "msg-tool",
			role: "toolResult",
			content: [{ type: "text", text: "tool output" }],
			timestamp: BASE_MS + 150,
			extra: { toolCallId: "call-1" },
		}),
		messageLine({
			messageId: "msg-custom",
			role: "custom",
			content: "",
			timestamp: BASE_MS + 175,
		}),
		'{"message_id":"msg-broken"',
	]);

	// An older generation: one older turn the active file no longer has, and a
	// copy of a reply it still has (same message_id, must not be repeated).
	writeLines(messagesPathFor(minimaxDir, SESSION_ONE, "messages.1.jsonl"), [
		messageLine({
			messageId: "msg-u0",
			role: "user",
			content: [{ type: "text", text: "Older question" }],
			timestamp: BASE_MS - 1000,
		}),
		messageLine({
			messageId: "msg-a2",
			role: "assistant",
			content: [{ type: "text", text: "answer two (stale copy)" }],
			timestamp: BASE_MS + 300,
		}),
	]);
}

function createSessionTwo(): void {
	writeLines(messagesPathFor(minimaxDir, SESSION_TWO), [
		messageLine({
			messageId: "msg-t1",
			role: "user",
			content: [{ type: "text", text: "Hello there" }],
			timestamp: BASE_MS + 10_000,
		}),
		messageLine({
			messageId: "msg-t2",
			role: "assistant",
			content: [{ type: "text", text: "Hi" }],
			timestamp: BASE_MS + 10_100,
		}),
	]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("detect returns null when the MiniMax home has no sessions", async () => {
	assert.equal(await minimaxCodeAdapter.detect(), null);
	assert.deepEqual(minimaxCodeAdapter.watchPaths?.() ?? [], []);
});

test("detect counts message-file session folders", async () => {
	ensureFixtures();
	const info = await minimaxCodeAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "minimax-code");
	assert.equal(info.displayName, "MiniMax Code");
	assert.equal(info.dataDir, minimaxDir);
	assert.equal(info.conversationCount, 2);
});

test("scan decodes session ids from the folder name and reports the root", async () => {
	ensureFixtures();
	const metas = await minimaxCodeAdapter.scan();
	assert.deepEqual(metas.map((meta) => meta.id).sort(), [
		SESSION_ONE,
		SESSION_TWO,
	].sort());

	const session = metas.find((meta) => meta.id === SESSION_ONE);
	assert.ok(session);
	assert.equal(session.source, "minimax-code");
	assert.equal(session.projectDir, "");
	assert.equal(session.rootDir, minimaxDir);
	assert.ok(session.fileSize > 0);
	assert.ok(!Number.isNaN(Date.parse(session.fileMtime)));
	// The active generation is the scanned file.
	const filePath = normalizePath(session.filePath);
	assert.ok(filePath.includes("v2/sessions/"));
	assert.ok(filePath.endsWith(`${sessionDirName(SESSION_ONE)}/messages.jsonl`));
});

test("parse rebuilds the conversation, strips injected context and merges generations", async () => {
	ensureFixtures();
	const metas = await minimaxCodeAdapter.scan();
	const meta = metas.find((item) => item.id === SESSION_ONE);
	assert.ok(meta);

	const parsed = await minimaxCodeAdapter.parse(meta);
	assert.equal(parsed.id, SESSION_ONE);
	assert.equal(parsed.source, "minimax-code");
	// No title is stored; the first prompt names the conversation.
	assert.equal(parsed.slug, "Older question");
	assert.equal(parsed.projectDir, "");
	assert.equal(parsed.projectName, "");
	assert.equal(parsed.cwd, null);
	assert.equal(parsed.gitBranch, null);

	// The older generation's turn, then the active file's four turns; the
	// duplicated reply (merge) and the toolResult/custom lines are skipped.
	assert.deepEqual(
		parsed.messages.map((message) => message.type),
		["user", "user", "assistant", "user", "assistant"],
	);
	const contents = parsed.messages.map((message) => message.content);
	assert.deepEqual(contents, [
		"Older question",
		"Say pong",
		"pong",
		"Second question",
		"answer two",
	]);
	assert.equal(
		parsed.messages.filter((message) => message.content === "answer two").length,
		1,
	);
	assert.ok(parsed.messages.every((message) => message.content !== "tool output"));

	const assistant = parsed.messages[2];
	assert.ok(assistant);
	assert.equal(assistant.thinking, "Just answer.");
	assert.equal(assistant.hasToolUse, true);
	assert.equal(assistant.hasCode, false);

	// Timestamps are epoch ms from the message and stay ascending.
	assert.equal(
		parsed.messages[0]?.timestamp,
		new Date(BASE_MS - 1000).toISOString(),
	);
	assert.equal(parsed.messages[1]?.timestamp, new Date(BASE_MS).toISOString());
	assert.equal(
		parsed.messages[2]?.timestamp,
		new Date(BASE_MS + 100).toISOString(),
	);
	assert.equal(
		parsed.messages[3]?.timestamp,
		new Date(BASE_MS + 200).toISOString(),
	);
	assert.equal(
		parsed.messages[4]?.timestamp,
		new Date(BASE_MS + 300).toISOString(),
	);
	for (let index = 1; index < parsed.messages.length; index += 1) {
		assert.ok(
			Date.parse(parsed.messages[index].timestamp) >=
				Date.parse(parsed.messages[index - 1].timestamp),
		);
	}
	assert.equal(parsed.firstMessageAt, parsed.messages[0]?.timestamp);
	assert.equal(
		parsed.lastMessageAt,
		parsed.messages[parsed.messages.length - 1]?.timestamp,
	);
});

test("parse reads a second session's plain user/assistant turns", async () => {
	ensureFixtures();
	const metas = await minimaxCodeAdapter.scan();
	const meta = metas.find((item) => item.id === SESSION_TWO);
	assert.ok(meta);

	const parsed = await minimaxCodeAdapter.parse(meta);
	assert.equal(parsed.id, SESSION_TWO);
	assert.equal(parsed.slug, "Hello there");
	assert.equal(parsed.messages.length, 2);
	assert.equal(parsed.messages[0]?.content, "Hello there");
	assert.equal(parsed.messages[1]?.content, "Hi");
	assert.equal(parsed.messages[1]?.hasToolUse, false);
});

test("watchPaths covers the local message files only", () => {
	ensureFixtures();
	const paths = (minimaxCodeAdapter.watchPaths?.() ?? []).map(normalizePath);
	assert.equal(paths.length, 1);
	assert.ok(paths[0]?.endsWith("v2/sessions/**/messages*.jsonl"));
});

test("WSL distro sessions are detected, scanned and parsed from an extra root", async () => {
	ensureFixtures();
	const wslHome = join(root, "wsl-home");
	const wslSessionId = "mvs_wsl_session";
	const wslRoot = join(wslHome, ".minimax");
	const wslPromptMs = BASE_MS + 900_000;
	writeLines(messagesPathFor(wslRoot, wslSessionId), [
		messageLine({
			messageId: "msg-w1",
			role: "user",
			content: [{ type: "text", text: "WSL question" }],
			timestamp: wslPromptMs,
		}),
		messageLine({
			messageId: "msg-w2",
			role: "assistant",
			content: [{ type: "text", text: "WSL answer" }],
			timestamp: wslPromptMs + 100,
		}),
	]);

	setWslHomesForTesting([wslHome]);
	try {
		const info = await minimaxCodeAdapter.detect();
		assert.ok(info);
		// Two local sessions plus the one inside the WSL distro home.
		assert.equal(info.conversationCount, 3);
		// detect still reports the primary Windows home.
		assert.equal(info.dataDir, minimaxDir);

		const metas = await minimaxCodeAdapter.scan();
		assert.equal(metas.length, 3);
		const wslMeta = metas.find((meta) => meta.id === wslSessionId);
		assert.ok(wslMeta);
		assert.equal(wslMeta.rootDir, wslRoot);
		assert.ok(normalizePath(wslMeta.filePath).includes("wsl-home/.minimax"));

		const parsed = await minimaxCodeAdapter.parse(wslMeta);
		assert.equal(parsed.id, wslSessionId);
		assert.equal(parsed.slug, "WSL question");
		assert.equal(parsed.messages.length, 2);
		assert.equal(parsed.messages[0]?.content, "WSL question");
		assert.equal(parsed.messages[1]?.content, "WSL answer");

		// The watcher stays on local Windows paths only.
		const paths = (minimaxCodeAdapter.watchPaths?.() ?? []).map(normalizePath);
		assert.equal(paths.length, 1);
		assert.ok(!paths[0]?.includes("wsl-home"));
	} finally {
		setWslHomesForTesting(null);
	}
});
