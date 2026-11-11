import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

// ---------------------------------------------------------------------------
// Self-contained fixture: a fake Kimi Code home under a temp dir. The home env
// var must be set before the adapter (and appConfig) is imported.
// ---------------------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), "chatcrystal-kimi-test-"));
const kimiDir = join(root, "kimi-home");

process.env.DATA_DIR = join(root, "data");
process.env.KIMI_CODE_HOME = kimiDir;
// A real WSL distro may be running on this machine; keep it out of the tests.
process.env.CHATCRYSTAL_WSL = "0";

const { kimiAdapter } = await import("./kimi.js");
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

function wireLine(record: Record<string, unknown>): string {
	return JSON.stringify(record);
}

const BASE_MS = Date.UTC(2026, 8, 27, 10, 0, 0);
const MAIN_SLUG = "wd_parser_000000000001";
const MAIN_SESSION = "session_main-1";
const LEGACY_SLUG = "wd_legacy_000000000002";
const LEGACY_SESSION = "session_legacy-1";
const LEGACY_MS = Date.UTC(2026, 5, 15, 5, 49, 26, 333);
const INDEXED_SLUG = "wd_indexed_000000000003";
const INDEXED_SESSION = "session_indexed-1";
const INDEXED_MS = Date.UTC(2026, 7, 2, 21, 9, 7, 20);
const SUBAGENT_SLUG = "wd_sub_000000000004";
const SUBAGENT_SESSION = "session_sub-1";

function sessionDirFor(slug: string, session: string): string {
	return join(kimiDir, "sessions", slug, session);
}

function mainWirePath(slug: string, session: string): string {
	return join(sessionDirFor(slug, session), "agents", "main", "wire.jsonl");
}

function promptLine(text: string, time: number): string {
	return wireLine({
		type: "turn.prompt",
		input: [{ type: "text", text }],
		origin: { kind: "user" },
		time,
	});
}

function loopEvent(
	event: Record<string, unknown>,
	time: number,
): string {
	return wireLine({ type: "context.append_loop_event", event, time });
}

let fixturesReady = false;

function ensureFixtures(): void {
	if (fixturesReady) return;
	fixturesReady = true;
	createMainSession();
	createLegacySession();
	createIndexedSession();
	createSubagentOnlySession();
}

/** A protocol 1.4 session: turn.prompt, loop events, thinking, a tool call. */
function createMainSession(): void {
	const promptOne = BASE_MS + 60_000;
	const promptTwo = BASE_MS + 180_000;

	writeJson(join(sessionDirFor(MAIN_SLUG, MAIN_SESSION), "state.json"), {
		createdAt: new Date(BASE_MS).toISOString(),
		updatedAt: new Date(BASE_MS + 240_000).toISOString(),
		title: "Kimi parser work",
		titleKind: "custom",
		isCustomTitle: true,
		cwd: "/work/kimi-app",
		agents: { main: { type: "main", parentAgentId: null } },
	});

	writeLines(mainWirePath(MAIN_SLUG, MAIN_SESSION), [
		wireLine({
			type: "metadata",
			protocol_version: "1.4",
			created_at: BASE_MS,
		}),
		promptLine("Fix the parser", promptOne),
		loopEvent(
			{ type: "content.part", part: { type: "think", think: "Walk the files." } },
			promptOne + 1000,
		),
		loopEvent(
			{
				type: "content.part",
				part: { type: "text", text: "Reading the parser now." },
			},
			promptOne + 1000,
		),
		loopEvent(
			{
				type: "tool.call",
				name: "read_file",
				toolCallId: "call-1",
				args: { path: "src/parser.ts" },
			},
			promptOne + 2000,
		),
		loopEvent(
			{ type: "tool.result", toolCallId: "call-1", result: { output: "ok" } },
			promptOne + 3000,
		),
		loopEvent(
			{ type: "step.end", finishReason: "tool_use" },
			promptOne + 4000,
		),
		wireLine({
			type: "usage.record",
			model: "kimi-code/k3",
			usage: { inputOther: 100, output: 20 },
			time: promptOne + 4000,
		}),
		promptLine("Now run the tests", promptTwo),
		loopEvent(
			{
				type: "content.part",
				part: { type: "text", text: "Tests pass." },
			},
			promptTwo + 1000,
		),
		loopEvent({ type: "step.end", finishReason: "end_turn" }, promptTwo + 2000),
		// Kimi Code's own append_message repeats the prompt and has a time.
		wireLine({
			type: "context.append_message",
			message: {
				role: "user",
				content: [{ type: "text", text: "Fix the parser" }],
				origin: { kind: "user" },
			},
			time: promptOne,
		}),
		'{"type":"turn.prompt"',
	]);

	// A subagent's wire file is not the session's main conversation.
	writeLines(
		join(sessionDirFor(MAIN_SLUG, MAIN_SESSION), "agents", "agent-0", "wire.jsonl"),
		[
			wireLine({
				type: "turn.prompt",
				input: [{ type: "text", text: "subagent task text" }],
				origin: { kind: "system_trigger", name: "subagent" },
				time: promptOne,
			}),
		],
	);
}

/** A protocol 1.0 session: context.append_message records with no time. */
function createLegacySession(): void {
	writeJson(join(sessionDirFor(LEGACY_SLUG, LEGACY_SESSION), "state.json"), {
		createdAt: LEGACY_MS,
		updatedAt: LEGACY_MS,
		title: "Legacy session",
		isCustomTitle: false,
		workDir: "/work/legacy-app",
		agents: { main: { type: "main", parentAgentId: null } },
	});
	writeLines(mainWirePath(LEGACY_SLUG, LEGACY_SESSION), [
		wireLine({
			type: "metadata",
			protocol_version: "1.0",
			created_at: LEGACY_MS,
		}),
		wireLine({
			type: "context.append_message",
			message: {
				role: "user",
				content: [{ type: "text", text: "Old prompt" }],
				toolCalls: [],
			},
		}),
		wireLine({
			type: "context.append_message",
			message: {
				role: "assistant",
				content: [
					{ type: "think", think: "Old thought" },
					{ type: "text", text: "Old answer" },
				],
				toolCalls: [{ id: "call-old", name: "read_file", arguments: {} }],
			},
		}),
	]);
}

/** An early session: its folder is only in the root session_index.jsonl. */
function createIndexedSession(): void {
	writeJson(join(sessionDirFor(INDEXED_SLUG, INDEXED_SESSION), "state.json"), {
		createdAt: INDEXED_MS,
		updatedAt: INDEXED_MS,
		title: "Indexed session",
	});
	writeLines(join(kimiDir, "session_index.jsonl"), [
		wireLine({
			sessionId: INDEXED_SESSION,
			sessionDir: `${INDEXED_SLUG}/${INDEXED_SESSION}`,
			workDir: "/home/me/indexed-app",
		}),
	]);
	writeLines(mainWirePath(INDEXED_SLUG, INDEXED_SESSION), [
		promptLine("Indexed prompt", INDEXED_MS + 1000),
		loopEvent(
			{
				type: "content.part",
				part: { type: "text", text: "Indexed answer" },
			},
			INDEXED_MS + 2000,
		),
		loopEvent({ type: "step.end", finishReason: "end_turn" }, INDEXED_MS + 3000),
	]);
}

/** A folder with only a subagent wire file: not a session of its own. */
function createSubagentOnlySession(): void {
	writeLines(
		join(
			sessionDirFor(SUBAGENT_SLUG, SUBAGENT_SESSION),
			"agents",
			"agent-0",
			"wire.jsonl",
		),
		[promptLine("only a subagent", BASE_MS)],
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("detect returns null when the Kimi Code home has no sessions", async () => {
	assert.equal(await kimiAdapter.detect(), null);
	assert.deepEqual(kimiAdapter.watchPaths?.() ?? [], []);
});

test("detect counts main-agent sessions only", async () => {
	ensureFixtures();
	const info = await kimiAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "kimi");
	assert.equal(info.displayName, "Kimi Code");
	assert.equal(info.dataDir, kimiDir);
	// The subagent-only folder is not a session of its own.
	assert.equal(info.conversationCount, 3);
});

test("scan reports session folders, working dirs and the scanned root", async () => {
	ensureFixtures();
	const metas = await kimiAdapter.scan();
	assert.deepEqual(
		metas.map((meta) => meta.id).sort(),
		[MAIN_SESSION, LEGACY_SESSION, INDEXED_SESSION].sort(),
	);

	const main = metas.find((meta) => meta.id === MAIN_SESSION);
	assert.ok(main);
	assert.equal(main.source, "kimi");
	assert.equal(main.projectDir, "/work/kimi-app");
	assert.equal(main.rootDir, kimiDir);
	assert.ok(main.fileSize > 0);
	assert.ok(!Number.isNaN(Date.parse(main.fileMtime)));
	const mainPath = normalizePath(main.filePath);
	assert.ok(mainPath.includes(`/${MAIN_SLUG}/${MAIN_SESSION}/agents/main/wire.jsonl`));

	const legacy = metas.find((meta) => meta.id === LEGACY_SESSION);
	assert.ok(legacy);
	assert.equal(legacy.projectDir, "/work/legacy-app");

	// An early state.json has no cwd; the root session_index.jsonl names it.
	const indexed = metas.find((meta) => meta.id === INDEXED_SESSION);
	assert.ok(indexed);
	assert.equal(indexed.projectDir, "/home/me/indexed-app");
});

test("parse reads prompt/loop events, thinking and tool calls of a 1.4 session", async () => {
	ensureFixtures();
	const metas = await kimiAdapter.scan();
	const meta = metas.find((item) => item.id === MAIN_SESSION);
	assert.ok(meta);

	const parsed = await kimiAdapter.parse(meta);
	assert.equal(parsed.id, MAIN_SESSION);
	assert.equal(parsed.source, "kimi");
	assert.equal(parsed.slug, "Kimi parser work");
	assert.equal(parsed.projectDir, "/work/kimi-app");
	assert.equal(parsed.projectName, "kimi-app");
	assert.equal(parsed.cwd, "/work/kimi-app");
	assert.equal(parsed.gitBranch, null);

	const promptOne = BASE_MS + 60_000;
	const promptTwo = BASE_MS + 180_000;
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
	assert.equal(firstUser.content, "Fix the parser");
	assert.equal(firstUser.timestamp, new Date(promptOne).toISOString());
	assert.equal(firstAssistant.content, "Reading the parser now.");
	assert.equal(firstAssistant.thinking, "Walk the files.");
	assert.equal(firstAssistant.hasToolUse, true);
	assert.equal(firstAssistant.timestamp, new Date(promptOne + 1000).toISOString());
	assert.equal(secondUser.content, "Now run the tests");
	assert.equal(secondAssistant.content, "Tests pass.");
	assert.equal(secondAssistant.hasToolUse, false);

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
	// The subagent's wire file and Kimi Code's timed append_message are skipped.
	assert.ok(
		parsed.messages.every((message) => message.content !== "subagent task text"),
	);
	assert.equal(
		parsed.messages.filter((message) => message.content === "Fix the parser")
			.length,
		1,
	);
});

test("parse reads a protocol 1.0 session from timeless append_message records", async () => {
	ensureFixtures();
	const metas = await kimiAdapter.scan();
	const meta = metas.find((item) => item.id === LEGACY_SESSION);
	assert.ok(meta);

	const parsed = await kimiAdapter.parse(meta);
	assert.equal(parsed.id, LEGACY_SESSION);
	assert.equal(parsed.slug, "Legacy session");
	assert.equal(parsed.projectDir, "/work/legacy-app");
	assert.equal(parsed.messages.length, 2);
	assert.equal(parsed.messages[0]?.type, "user");
	assert.equal(parsed.messages[0]?.content, "Old prompt");
	assert.equal(parsed.messages[1]?.content, "Old answer");
	assert.equal(parsed.messages[1]?.thinking, "Old thought");
	assert.equal(parsed.messages[1]?.hasToolUse, true);
	// Timeless records are laid out from the session's createdAt.
	assert.equal(parsed.messages[0]?.timestamp, new Date(LEGACY_MS).toISOString());
	assert.equal(
		parsed.messages[1]?.timestamp,
		new Date(LEGACY_MS + 1000).toISOString(),
	);
});

test("parse an early session takes its working dir from session_index.jsonl", async () => {
	ensureFixtures();
	const metas = await kimiAdapter.scan();
	const meta = metas.find((item) => item.id === INDEXED_SESSION);
	assert.ok(meta);

	const parsed = await kimiAdapter.parse(meta);
	assert.equal(parsed.id, INDEXED_SESSION);
	assert.equal(parsed.projectDir, "/home/me/indexed-app");
	assert.equal(parsed.projectName, "indexed-app");
	assert.equal(parsed.messages.length, 2);
	assert.equal(parsed.messages[0]?.content, "Indexed prompt");
	assert.equal(parsed.messages[1]?.content, "Indexed answer");
});

test("watchPaths covers the local wire files only", () => {
	ensureFixtures();
	const paths = (kimiAdapter.watchPaths?.() ?? []).map(normalizePath);
	assert.equal(paths.length, 1);
	assert.ok(paths[0]?.endsWith("sessions/**/wire.jsonl"));
});

test("WSL distro sessions are detected, scanned and parsed from an extra root", async () => {
	ensureFixtures();
	const wslHome = join(root, "wsl-home");
	const wslSession = "session_wsl-1";
	const wslSlug = "wd_wsl_000000000010";
	const wslRoot = join(wslHome, ".kimi-code");
	const wslSessionDir = join(wslRoot, "sessions", wslSlug, wslSession);
	const wslPromptMs = BASE_MS + 600_000;
	writeJson(join(wslSessionDir, "state.json"), {
		createdAt: new Date(wslPromptMs).toISOString(),
		updatedAt: new Date(wslPromptMs).toISOString(),
		title: "WSL Kimi session",
		cwd: "/home/me/wsl-kimi",
	});
	writeLines(join(wslSessionDir, "agents", "main", "wire.jsonl"), [
		promptLine("WSL prompt", wslPromptMs),
		loopEvent(
			{
				type: "content.part",
				part: { type: "text", text: "WSL answer" },
			},
			wslPromptMs + 1000,
		),
		loopEvent({ type: "step.end", finishReason: "end_turn" }, wslPromptMs + 2000),
	]);

	setWslHomesForTesting([wslHome]);
	try {
		const info = await kimiAdapter.detect();
		assert.ok(info);
		// Three local sessions plus the one inside the WSL distro home.
		assert.equal(info.conversationCount, 4);
		// detect still reports the primary Windows home.
		assert.equal(info.dataDir, kimiDir);

		const metas = await kimiAdapter.scan();
		assert.equal(metas.length, 4);
		const wslMeta = metas.find((meta) => meta.id === wslSession);
		assert.ok(wslMeta);
		assert.equal(wslMeta.rootDir, wslRoot);
		assert.equal(wslMeta.projectDir, "/home/me/wsl-kimi");
		assert.ok(normalizePath(wslMeta.filePath).includes("wsl-home/.kimi-code"));

		const parsed = await kimiAdapter.parse(wslMeta);
		assert.equal(parsed.id, wslSession);
		assert.equal(parsed.slug, "WSL Kimi session");
		assert.equal(parsed.projectDir, "/home/me/wsl-kimi");
		assert.equal(parsed.messages.length, 2);
		assert.equal(parsed.messages[0]?.content, "WSL prompt");
		assert.equal(parsed.messages[1]?.content, "WSL answer");

		// The watcher stays on local Windows paths only.
		const paths = (kimiAdapter.watchPaths?.() ?? []).map(normalizePath);
		assert.equal(paths.length, 1);
		assert.ok(!paths[0]?.includes("wsl-home"));
	} finally {
		setWslHomesForTesting(null);
	}
});
