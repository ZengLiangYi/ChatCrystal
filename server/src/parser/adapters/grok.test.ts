import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

// ---------------------------------------------------------------------------
// Self-contained fixture: a fake Grok Build home under a temp dir. The home env
// var must be set before the adapter (and appConfig) is imported.
// ---------------------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), "chatcrystal-grok-test-"));
const grokDir = join(root, "grok-home");

process.env.DATA_DIR = join(root, "data");
process.env.GROK_HOME = grokDir;
// A real WSL distro may be running on this machine; keep it out of the tests.
process.env.CHATCRYSTAL_WSL = "0";

const { grokAdapter } = await import("./grok.js");
const { setWslHomesForTesting } = await import("../wsl.js");

after(() => {
	setWslHomesForTesting(null);
	rmSync(root, { recursive: true, force: true });
});

function writeJson(filePath: string, value: unknown): void {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function writeLines(filePath: string, lines: string[]): void {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${lines.join("\n")}\n`, "utf-8");
}

function normalizePath(filePath: string): string {
	return filePath.replace(/\\/g, "/");
}

const BASE_SECONDS = Date.UTC(2026, 8, 27, 8, 0, 0) / 1000;
const CWD_ENCODED = "%2Fwork%2Fgrok-app";
const APP_CWD = "/work/grok-app";
const SESSION_A = "0190aaaa-0000-7000-8000-00000000000a";
const SESSION_SUBAGENT = "0190aaaa-0000-7000-8000-00000000000b";
const SESSION_FORK = "0190aaaa-0000-7000-8000-00000000000c";
const SESSION_EMPTY = "0190aaaa-0000-7000-8000-00000000000d";

interface UpdateLineOptions {
	sessionId: string;
	time: number;
	update: Record<string, unknown>;
}

function updateLine(options: UpdateLineOptions): string {
	return JSON.stringify({
		timestamp: options.time,
		method: "session/update",
		params: { sessionId: options.sessionId, update: options.update },
	});
}

function userChunk(
	sessionId: string,
	time: number,
	text: string,
	extraMeta: Record<string, unknown> = { promptIndex: 0 },
): string {
	return updateLine({
		sessionId,
		time,
		update: {
			sessionUpdate: "user_message_chunk",
			content: { type: "text", text },
			_meta: extraMeta,
		},
	});
}

function assistantChunk(sessionId: string, time: number, text: string): string {
	return updateLine({
		sessionId,
		time,
		update: {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text },
		},
	});
}

function thoughtChunk(sessionId: string, time: number, text: string): string {
	return updateLine({
		sessionId,
		time,
		update: {
			sessionUpdate: "agent_thought_chunk",
			content: { type: "text", text },
		},
	});
}

function turnCompleted(sessionId: string, time: number): string {
	return updateLine({
		sessionId,
		time,
		update: { sessionUpdate: "turn_completed", stop_reason: "end_turn" },
	});
}

let fixturesReady = false;

function ensureFixtures(): void {
	if (fixturesReady) return;
	fixturesReady = true;
	createSessionA();
	createSubagentSession();
	createFork();
	createEmptySession();
}

function sessionDirFor(sessionId: string): string {
	return join(grokDir, "sessions", CWD_ENCODED, sessionId);
}

/** Two turns: a prompt split into chunks, thinking, a tool call, a host command. */
function createSessionA(): void {
	const sessionDir = sessionDirFor(SESSION_A);
	writeJson(join(sessionDir, "summary.json"), {
		info: { id: SESSION_A, cwd: APP_CWD },
		generated_title: "Refactor the importer",
		session_summary: "ignored when generated_title exists",
		created_at: new Date(BASE_SECONDS * 1000).toISOString(),
		updated_at: new Date(BASE_SECONDS * 1000).toISOString(),
		current_model_id: "grok-4.7",
	});
	writeLines(join(sessionDir, "updates.jsonl"), [
		updateLine({
			sessionId: SESSION_A,
			time: BASE_SECONDS,
			update: { sessionUpdate: "hook_execution", event_name: "session_start" },
		}),
		// One prompt may arrive as several chunks.
		userChunk(SESSION_A, BASE_SECONDS + 1, "Port the "),
		userChunk(SESSION_A, BASE_SECONDS + 1, "parser"),
		thoughtChunk(SESSION_A, BASE_SECONDS + 2, "Read the parser first."),
		assistantChunk(
			SESSION_A,
			BASE_SECONDS + 3,
			"I'll port the parser.",
		),
		updateLine({
			sessionId: SESSION_A,
			time: BASE_SECONDS + 4,
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "call-1",
				title: "read_file",
				rawInput: { target_file: "src/parser.ts" },
				_meta: { "x.ai/tool": { name: "read_file" } },
			},
		}),
		updateLine({
			sessionId: SESSION_A,
			time: BASE_SECONDS + 5,
			update: {
				sessionUpdate: "tool_call_update",
				toolCallId: "call-1",
				status: "completed",
			},
		}),
		userChunk(SESSION_A, BASE_SECONDS + 6, "and add tests"),
		assistantChunk(SESSION_A, BASE_SECONDS + 7, "Tests added."),
		turnCompleted(SESSION_A, BASE_SECONDS + 8),
		// A host command is marked hostTurn and is not something the person typed.
		userChunk(SESSION_A, BASE_SECONDS + 9, "/compact", { hostTurn: true }),
		'{"timestamp":1790496',
	]);
}

/** A subagent's own folder is a session folder too. */
function createSubagentSession(): void {
	const sessionDir = sessionDirFor(SESSION_SUBAGENT);
	writeJson(join(sessionDir, "summary.json"), {
		info: { id: SESSION_SUBAGENT, cwd: APP_CWD },
		generated_title: "Explore parser tests",
		created_at: new Date((BASE_SECONDS + 30) * 1000).toISOString(),
		session_kind: "subagent:explore",
		parent_session_id: SESSION_A,
	});
	writeLines(join(sessionDir, "updates.jsonl"), [
		userChunk(SESSION_SUBAGENT, BASE_SECONDS + 30, "Find the parser tests"),
		assistantChunk(
			SESSION_SUBAGENT,
			BASE_SECONDS + 40,
			"They live in src/parser.test.ts",
		),
		turnCompleted(SESSION_SUBAGENT, BASE_SECONDS + 50),
	]);
}

/**
 * A fork starts with a copy of its source's updates (older than its
 * created_at); only the turns written after it are its own.
 */
function createFork(): void {
	const forkCreated = BASE_SECONDS + 3600;
	const sessionDir = sessionDirFor(SESSION_FORK);
	writeJson(join(sessionDir, "summary.json"), {
		info: { id: SESSION_FORK, cwd: APP_CWD },
		generated_title: "Parser port, another way",
		created_at: new Date(forkCreated * 1000).toISOString(),
		parent_session_id: SESSION_A,
	});
	writeLines(join(sessionDir, "updates.jsonl"), [
		// Copied from SESSION_A, before the fork was made.
		userChunk(SESSION_FORK, BASE_SECONDS + 1, "Port the parser"),
		assistantChunk(
			SESSION_FORK,
			BASE_SECONDS + 3,
			"I'll port the parser.",
		),
		// The fork's own turn.
		userChunk(SESSION_FORK, forkCreated + 10, "Try the other parser"),
		assistantChunk(SESSION_FORK, forkCreated + 20, "Other parser it is."),
		turnCompleted(SESSION_FORK, forkCreated + 30),
	]);
}

/** Hooks only: a listed session with no conversation turns. */
function createEmptySession(): void {
	const sessionDir = sessionDirFor(SESSION_EMPTY);
	writeJson(join(sessionDir, "summary.json"), {
		info: { id: SESSION_EMPTY, cwd: APP_CWD },
		generated_title: "",
		session_summary: "",
		created_at: new Date((BASE_SECONDS + 7200) * 1000).toISOString(),
	});
	writeLines(join(sessionDir, "updates.jsonl"), [
		updateLine({
			sessionId: SESSION_EMPTY,
			time: BASE_SECONDS + 7200,
			update: { sessionUpdate: "hook_execution", event_name: "session_start" },
		}),
		updateLine({
			sessionId: SESSION_EMPTY,
			time: BASE_SECONDS + 7260,
			update: { sessionUpdate: "hook_execution", event_name: "session_end" },
		}),
	]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("detect returns null when the Grok Build home has no sessions", async () => {
	assert.equal(await grokAdapter.detect(), null);
	assert.deepEqual(grokAdapter.watchPaths?.() ?? [], []);
});

test("detect counts every Grok Build session folder", async () => {
	ensureFixtures();
	const info = await grokAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "grok");
	assert.equal(info.displayName, "Grok Build");
	assert.equal(info.dataDir, grokDir);
	assert.equal(info.conversationCount, 4);
});

test("scan reports summary ids, cwd project dirs and the scanned root", async () => {
	ensureFixtures();
	const metas = await grokAdapter.scan();
	assert.equal(metas.length, 4);

	const main = metas.find((meta) => meta.id === SESSION_A);
	assert.ok(main);
	assert.equal(main.source, "grok");
	assert.equal(main.projectDir, APP_CWD);
	assert.equal(main.rootDir, grokDir);
	assert.ok(main.fileSize > 0);
	assert.ok(!Number.isNaN(Date.parse(main.fileMtime)));
	const mainPath = normalizePath(main.filePath);
	assert.ok(mainPath.includes("%2Fwork%2Fgrok-app"));
	assert.ok(mainPath.endsWith(`${SESSION_A}/updates.jsonl`));

	const fork = metas.find((meta) => meta.id === SESSION_FORK);
	assert.ok(fork);
	// A fork's summary keeps its parent's link; it is still listed as a session.
	assert.equal(fork.projectDir, APP_CWD);
});

test("parse reads chunks, thinking and tool calls of a Grok Build session", async () => {
	ensureFixtures();
	const metas = await grokAdapter.scan();
	const meta = metas.find((item) => item.id === SESSION_A);
	assert.ok(meta);

	const parsed = await grokAdapter.parse(meta);
	assert.equal(parsed.id, SESSION_A);
	assert.equal(parsed.source, "grok");
	assert.equal(parsed.slug, "Refactor the importer");
	assert.equal(parsed.projectDir, APP_CWD);
	assert.equal(parsed.projectName, "grok-app");
	assert.equal(parsed.cwd, APP_CWD);
	assert.equal(parsed.gitBranch, null);

	// hostTurn chunks, tool_call_update lines and the corrupt line are skipped.
	assert.deepEqual(
		parsed.messages.map((message) => [message.type, message.role]),
		[
			["user", "user"],
			["assistant", "assistant"],
			["user", "user"],
			["assistant", "assistant"],
		],
	);

	const [firstUser, firstAssistant, secondUser, secondAssistant] =
		parsed.messages;
	assert.ok(firstUser && firstAssistant && secondUser && secondAssistant);

	// Two streamed user chunks form one prompt.
	assert.equal(firstUser.content, "Port the parser");
	assert.equal(firstUser.timestamp, new Date((BASE_SECONDS + 1) * 1000).toISOString());

	assert.equal(firstAssistant.content, "I'll port the parser.");
	assert.equal(firstAssistant.thinking, "Read the parser first.");
	assert.equal(firstAssistant.hasToolUse, true);
	assert.equal(firstAssistant.hasCode, false);
	assert.equal(
		firstAssistant.timestamp,
		new Date((BASE_SECONDS + 2) * 1000).toISOString(),
	);

	assert.equal(secondUser.content, "and add tests");
	assert.equal(secondAssistant.content, "Tests added.");
	assert.equal(secondAssistant.hasToolUse, false);

	// Messages are in ascending time order with ISO timestamps.
	for (let index = 1; index < parsed.messages.length; index += 1) {
		assert.ok(
			Date.parse(parsed.messages[index].timestamp) >=
				Date.parse(parsed.messages[index - 1].timestamp),
		);
	}
	for (const message of parsed.messages) {
		assert.equal(new Date(message.timestamp).toISOString(), message.timestamp);
	}
	assert.equal(parsed.firstMessageAt, firstUser.timestamp);
	assert.equal(parsed.lastMessageAt, secondAssistant.timestamp);
});

test("parse reads a subagent session as its own conversation", async () => {
	ensureFixtures();
	const metas = await grokAdapter.scan();
	const meta = metas.find((item) => item.id === SESSION_SUBAGENT);
	assert.ok(meta);

	const parsed = await grokAdapter.parse(meta);
	assert.equal(parsed.id, SESSION_SUBAGENT);
	assert.equal(parsed.slug, "Explore parser tests");
	assert.equal(parsed.messages.length, 2);
	assert.equal(parsed.messages[0]?.content, "Find the parser tests");
	assert.equal(parsed.messages[1]?.content, "They live in src/parser.test.ts");
});

test("parse a fork from its own turns, not the copied ones", async () => {
	ensureFixtures();
	const metas = await grokAdapter.scan();
	const meta = metas.find((item) => item.id === SESSION_FORK);
	assert.ok(meta);

	const parsed = await grokAdapter.parse(meta);
	assert.equal(parsed.id, SESSION_FORK);
	assert.equal(parsed.messages.length, 2);
	assert.equal(parsed.messages[0]?.content, "Try the other parser");
	assert.equal(parsed.messages[1]?.content, "Other parser it is.");
	// SESSION_A's copied prompt is older than the fork's creation time.
	assert.ok(
		parsed.messages.every((message) => message.content !== "Port the parser"),
	);
});

test("parse tolerates a session with no conversation turns", async () => {
	ensureFixtures();
	const metas = await grokAdapter.scan();
	const meta = metas.find((item) => item.id === SESSION_EMPTY);
	assert.ok(meta);

	const parsed = await grokAdapter.parse(meta);
	assert.equal(parsed.id, SESSION_EMPTY);
	assert.deepEqual(parsed.messages, []);
	assert.equal(parsed.slug, null);
	assert.equal(parsed.projectDir, APP_CWD);
	assert.equal(parsed.projectName, "grok-app");
});

test("watchPaths covers the local updates files only", () => {
	ensureFixtures();
	const paths = (grokAdapter.watchPaths?.() ?? []).map(normalizePath);
	assert.equal(paths.length, 1);
	assert.ok(paths[0]?.endsWith("sessions/**/updates.jsonl"));
});

test("WSL distro sessions are detected, scanned and parsed from an extra root", async () => {
	ensureFixtures();
	const wslHome = join(root, "wsl-home");
	const wslSessionId = "0190aaaa-0000-7000-8000-0000000000aa";
	const wslRoot = join(wslHome, ".grok");
	const wslSessionDir = join(
		wslRoot,
		"sessions",
		"%2Fhome%2Fme%2Fwsl-grok",
		wslSessionId,
	);
	writeJson(join(wslSessionDir, "summary.json"), {
		info: { id: wslSessionId, cwd: "/home/me/wsl-grok" },
		generated_title: "WSL Grok session",
		created_at: new Date(BASE_SECONDS * 1000).toISOString(),
	});
	writeLines(join(wslSessionDir, "updates.jsonl"), [
		userChunk(wslSessionId, BASE_SECONDS + 1, "WSL question"),
		assistantChunk(wslSessionId, BASE_SECONDS + 2, "WSL answer"),
		turnCompleted(wslSessionId, BASE_SECONDS + 3),
	]);

	setWslHomesForTesting([wslHome]);
	try {
		const info = await grokAdapter.detect();
		assert.ok(info);
		// Four local sessions plus the one inside the WSL distro home.
		assert.equal(info.conversationCount, 5);
		// detect still reports the primary Windows home.
		assert.equal(info.dataDir, grokDir);

		const metas = await grokAdapter.scan();
		assert.equal(metas.length, 5);
		const wslMeta = metas.find((meta) => meta.id === wslSessionId);
		assert.ok(wslMeta);
		assert.equal(wslMeta.rootDir, wslRoot);
		assert.equal(wslMeta.projectDir, "/home/me/wsl-grok");
		assert.ok(normalizePath(wslMeta.filePath).includes("wsl-home/.grok"));

		const parsed = await grokAdapter.parse(wslMeta);
		assert.equal(parsed.id, wslSessionId);
		assert.equal(parsed.slug, "WSL Grok session");
		assert.equal(parsed.projectDir, "/home/me/wsl-grok");
		assert.equal(parsed.messages.length, 2);
		assert.equal(parsed.messages[0]?.content, "WSL question");
		assert.equal(parsed.messages[1]?.content, "WSL answer");

		// The watcher stays on local Windows paths only.
		const paths = (grokAdapter.watchPaths?.() ?? []).map(normalizePath);
		assert.equal(paths.length, 1);
		assert.ok(!paths[0]?.includes("wsl-home"));
	} finally {
		setWslHomesForTesting(null);
	}
});
