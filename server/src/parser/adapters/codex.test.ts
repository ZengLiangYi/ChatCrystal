import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
import { zstdCompressSync } from "node:zlib";

// appConfig resolves its data dirs when config.ts is first imported, so the
// fixture base has to be in the environment before importing the adapter.
// Each test then points appConfig at its own temporary Codex home.
const baseDir = mkdtempSync(join(tmpdir(), "chatcrystal-codex-"));
process.env.CODEX_SESSIONS_DIR = join(baseDir, "initial", "sessions");
// Keep the developer's real WSL distros out of these fixtures; the WSL test
// injects its own home through setWslHomesForTesting().
process.env.CHATCRYSTAL_WSL = "0";

const { appConfig } = await import("../../config.js");
const { codexAdapter } = await import("./codex.js");
const { setWslHomesForTesting } = await import("../wsl.js");

const wslHome = mkdtempSync(join(tmpdir(), "chatcrystal-codex-wsl-home-"));

after(() => {
	setWslHomesForTesting(null);
	rmSync(baseDir, { recursive: true, force: true });
	rmSync(wslHome, { recursive: true, force: true });
});

interface CodexHome {
	home: string;
	sessions: string;
}

/** A throwaway Codex home; `sessions` is the local root the adapter scans. */
function useCodexHome(): CodexHome {
	const home = mkdtempSync(join(baseDir, "home-"));
	const sessions = join(home, "sessions");
	mkdirSync(sessions, { recursive: true });
	appConfig.codexSessionsDir = sessions;
	return { home, sessions };
}

interface WriteRolloutOptions {
	sessionsRoot: string;
	sessionId: string;
	archived?: boolean;
	zstd?: boolean;
	lines: string[];
}

/** Write one rollout file, either in `sessionsRoot` or its archived sibling. */
function writeRollout(options: WriteRolloutOptions): string {
	const rootDir = options.archived
		? resolve(dirname(options.sessionsRoot), "archived_sessions")
		: options.sessionsRoot;
	const dayDir = join(rootDir, "2026", "11", "11");
	mkdirSync(dayDir, { recursive: true });
	const fileName = `rollout-2026-11-11T10-00-00-${options.sessionId}.jsonl${options.zstd ? ".zst" : ""}`;
	const filePath = join(dayDir, fileName);
	if (options.zstd) {
		// One zstd frame per "append batch", the way Codex writes them.
		const buffer = Buffer.concat(
			options.lines.map((line) =>
				zstdCompressSync(Buffer.from(`${line}\n`, "utf8")),
			),
		);
		writeFileSync(filePath, buffer);
	} else {
		writeFileSync(filePath, `${options.lines.join("\n")}\n`, "utf-8");
	}
	return filePath;
}

function metaLine(options: {
	id: string;
	cwd: string;
	branch?: string;
	originator?: string;
}): string {
	return JSON.stringify({
		timestamp: "2026-11-11T10:00:00.000Z",
		type: "session_meta",
		payload: {
			id: options.id,
			cwd: options.cwd,
			originator: options.originator ?? "codex_cli",
			cli_version: "0.50.0",
			git: options.branch ? { branch: options.branch } : undefined,
		},
	});
}

function userMessageLine(
	text: string,
	timestamp = "2026-11-11T10:00:01.000Z",
): string {
	return JSON.stringify({
		timestamp,
		type: "event_msg",
		payload: { type: "user_message", message: text },
	});
}

function agentMessageLine(
	text: string,
	timestamp = "2026-11-11T10:00:02.000Z",
): string {
	return JSON.stringify({
		timestamp,
		type: "event_msg",
		payload: { type: "agent_message", message: text },
	});
}

function functionCallLine(timestamp = "2026-11-11T10:00:03.000Z"): string {
	return JSON.stringify({
		timestamp,
		type: "response_item",
		payload: { type: "function_call", name: "shell", arguments: '{"cmd":"ls"}' },
	});
}

/** Codex keeps thread names in `<home>/session_index.jsonl`. */
function writeSessionIndex(
	home: string,
	entries: Array<{ id: string; threadName: string }>,
): void {
	writeFileSync(
		join(home, "session_index.jsonl"),
		`${entries
			.map((entry) =>
				JSON.stringify({ id: entry.id, thread_name: entry.threadName }),
			)
			.join("\n")}\n`,
		"utf-8",
	);
}

function findMeta(
	metas: Awaited<ReturnType<typeof codexAdapter.scan>>,
	id: string,
) {
	const meta = metas.find((item) => item.id === id);
	assert.ok(meta, `expected scanned conversation ${id}`);
	return meta;
}

test("detect returns null when no rollouts exist", async () => {
	useCodexHome();
	assert.equal(await codexAdapter.detect(), null);
	assert.deepEqual(await codexAdapter.scan(), []);

	// A missing root is not an error either.
	appConfig.codexSessionsDir = join(baseDir, "missing", "sessions");
	assert.equal(await codexAdapter.detect(), null);
	assert.deepEqual(await codexAdapter.scan(), []);
});

test("detect and scan find live and archived rollouts in the local root", async () => {
	const { sessions } = useCodexHome();
	const livePath = writeRollout({
		sessionsRoot: sessions,
		sessionId: "live-thread",
		lines: [
			metaLine({ id: "thread-live", cwd: "C:\\work\\live-demo", branch: "main" }),
			userMessageLine("local question"),
			agentMessageLine("local answer"),
			functionCallLine(),
		],
	});
	const archivedPath = writeRollout({
		sessionsRoot: sessions,
		sessionId: "archived-thread",
		archived: true,
		lines: [
			metaLine({ id: "thread-archived", cwd: "C:\\work\\archived-demo" }),
			userMessageLine("archived question"),
			agentMessageLine("archived answer"),
		],
	});

	const info = await codexAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "codex");
	assert.equal(info.displayName, "Codex CLI");
	assert.equal(info.dataDir, sessions);
	assert.equal(info.conversationCount, 2);

	const metas = await codexAdapter.scan();
	assert.equal(metas.length, 2);
	const live = findMeta(metas, "live-thread");
	assert.equal(live.filePath, livePath);
	assert.equal(live.rootDir, sessions);
	assert.equal(live.source, "codex");
	assert.ok(live.fileSize > 0);
	const archived = findMeta(metas, "archived-thread");
	assert.equal(archived.filePath, archivedPath);
	// Archived rollouts are discovered through the same sessions root.
	assert.equal(archived.rootDir, sessions);

	const parsed = await codexAdapter.parse(live);
	assert.equal(parsed.id, "live-thread");
	assert.equal(parsed.source, "codex");
	assert.equal(parsed.slug, null);
	assert.equal(parsed.cwd, "C:\\work\\live-demo");
	assert.equal(parsed.projectDir, "C:\\work\\live-demo");
	assert.equal(parsed.projectName, "live-demo");
	assert.equal(parsed.gitBranch, "main");
	assert.deepEqual(
		parsed.messages.map((message) => [message.type, message.content]),
		[
			["user", "local question"],
			["assistant", "local answer"],
		],
	);
	// The function_call after the reply marks it as tool-using.
	assert.equal(parsed.messages[1]?.hasToolUse, true);
});

test("resumed rollouts keep distinct ids even when they share a thread id", async () => {
	const { home, sessions } = useCodexHome();
	writeSessionIndex(home, [
		{ id: "thread-shared", threadName: "Shared thread title" },
	]);

	writeRollout({
		sessionsRoot: sessions,
		sessionId: "resume-one",
		lines: [
			metaLine({ id: "thread-shared", cwd: "C:\\work\\resume" }),
			userMessageLine("first run"),
			agentMessageLine("first reply"),
		],
	});
	const secondPath = writeRollout({
		sessionsRoot: sessions,
		sessionId: "resume-two",
		lines: [
			metaLine({ id: "thread-shared", cwd: "C:\\work\\resume" }),
			userMessageLine("resumed question", "2026-11-11T11:00:01.000Z"),
			agentMessageLine("resumed answer", "2026-11-11T11:00:02.000Z"),
		],
	});

	const metas = await codexAdapter.scan();
	assert.equal(metas.length, 2);
	assert.deepEqual(
		metas.map((meta) => meta.id).sort(),
		["resume-one", "resume-two"],
	);

	for (const id of ["resume-one", "resume-two"]) {
		const meta = findMeta(metas, id);
		const parsed = await codexAdapter.parse(meta);
		// Both files carry the same thread id in session_meta; the parser keeps
		// the rollout-file id so import dedup never collapses the two sessions.
		assert.equal(parsed.id, id);
		// Thread names come from the root's session_index.jsonl.
		assert.equal(parsed.slug, "Shared thread title");
	}

	const second = findMeta(metas, "resume-two");
	assert.equal(second.filePath, secondPath);
	const parsedSecond = await codexAdapter.parse(second);
	assert.equal(parsedSecond.messages[0]?.content, "resumed question");
});

test("scan and parse read multi-frame zstd rollouts", async () => {
	const { sessions } = useCodexHome();
	const filePath = writeRollout({
		sessionsRoot: sessions,
		sessionId: "zstd-thread",
		zstd: true,
		lines: [
			metaLine({ id: "thread-zstd", cwd: "/home/user/code/zipped-app" }),
			userMessageLine("zipped question"),
			agentMessageLine("zipped answer"),
		],
	});

	const info = await codexAdapter.detect();
	assert.ok(info);
	assert.equal(info.conversationCount, 1);

	const metas = await codexAdapter.scan();
	assert.equal(metas.length, 1);
	const meta = findMeta(metas, "zstd-thread");
	assert.equal(meta.filePath, filePath);
	assert.match(meta.filePath, /\.jsonl\.zst$/);
	assert.equal(meta.rootDir, sessions);

	const parsed = await codexAdapter.parse(meta);
	assert.deepEqual(
		parsed.messages.map((message) => [message.type, message.content]),
		[
			["user", "zipped question"],
			["assistant", "zipped answer"],
		],
	);
});

test("detect, scan and parse include sessions from a WSL distro home", async () => {
	const { sessions: localSessions } = useCodexHome();
	writeRollout({
		sessionsRoot: localSessions,
		sessionId: "local-thread",
		lines: [
			metaLine({ id: "thread-local", cwd: "C:\\work\\local-demo" }),
			userMessageLine("local question"),
			agentMessageLine("local answer"),
		],
	});

	const wslSessions = join(wslHome, ".codex", "sessions");
	const wslLivePath = writeRollout({
		sessionsRoot: wslSessions,
		sessionId: "wsl-thread",
		lines: [
			metaLine({ id: "thread-wsl", cwd: "/home/wsl-user/code/wsl-app" }),
			userMessageLine("wsl question"),
			agentMessageLine("wsl answer"),
		],
	});
	// The archived sibling is derived per root, including a WSL root.
	const wslArchivedPath = writeRollout({
		sessionsRoot: wslSessions,
		sessionId: "wsl-archived-thread",
		archived: true,
		lines: [
			metaLine({ id: "thread-wsl-archived", cwd: "/home/wsl-user/code/old" }),
			userMessageLine("archived wsl question"),
			agentMessageLine("archived wsl answer"),
		],
	});

	setWslHomesForTesting([wslHome]);
	try {
		const info = await codexAdapter.detect();
		assert.ok(info);
		assert.equal(info.dataDir, localSessions);
		// One local rollout plus the WSL root's live and archived rollouts.
		assert.equal(info.conversationCount, 3);

		const metas = await codexAdapter.scan();
		assert.equal(metas.length, 3);
		assert.equal(findMeta(metas, "local-thread").rootDir, localSessions);

		const wsl = findMeta(metas, "wsl-thread");
		assert.equal(wsl.rootDir, wslSessions);
		assert.equal(wsl.filePath, wslLivePath);
		assert.ok(wsl.filePath.startsWith(wslHome));

		const wslArchived = findMeta(metas, "wsl-archived-thread");
		assert.equal(wslArchived.rootDir, wslSessions);
		assert.equal(wslArchived.filePath, wslArchivedPath);

		const parsed = await codexAdapter.parse(wsl);
		assert.equal(parsed.id, "wsl-thread");
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
		const watched = codexAdapter.watchPaths?.() ?? [];
		assert.ok(watched.length > 0);
		for (const path of watched) assert.ok(!path.startsWith(wslHome));

		// The WSL root still counts when the local install is missing.
		const missingLocal = join(baseDir, "missing-local", "sessions");
		appConfig.codexSessionsDir = missingLocal;
		const wslOnly = await codexAdapter.detect();
		assert.ok(wslOnly);
		assert.equal(wslOnly.dataDir, missingLocal);
		assert.equal(wslOnly.conversationCount, 2);
		appConfig.codexSessionsDir = localSessions;
	} finally {
		setWslHomesForTesting(null);
	}
});

test("UNC session roots derive the sibling archived_sessions folder", () => {
	// The fixture roots above are ordinary Windows paths; WSL roots are UNC
	// paths. Windows path semantics keep the UNC prefix when walking up, which
	// is what rolloutRoots() relies on for `archived_sessions`.
	const uncSessions =
		"\\\\wsl.localhost\\Ubuntu-24.04\\home\\zly\\.codex\\sessions";
	assert.equal(
		resolve(dirname(uncSessions), "archived_sessions"),
		"\\\\wsl.localhost\\Ubuntu-24.04\\home\\zly\\.codex\\archived_sessions",
	);
});

test("watchPaths returns the local rollout globs only", () => {
	const { sessions } = useCodexHome();
	assert.deepEqual(codexAdapter.watchPaths?.(), [`${sessions}/**/*.jsonl*`]);

	// The archived sibling is watched when it exists on the local root.
	const archived = resolve(dirname(sessions), "archived_sessions");
	mkdirSync(archived, { recursive: true });
	assert.deepEqual(codexAdapter.watchPaths?.(), [
		`${sessions}/**/*.jsonl*`,
		`${archived}/**/*.jsonl*`,
	]);
});

test("reads Codex >= 0.160 item_completed events", async () => {
	const { sessions } = useCodexHome();
	let seq = 0;
	const itemCompleted = (
		itemType: string,
		content?: unknown,
	): string =>
		JSON.stringify({
			timestamp: new Date(Date.UTC(2026, 10, 11, 10, 0, seq++)).toISOString(),
			type: "event_msg",
			payload: { type: "item_completed", item: { type: itemType, content } },
		});
	const responseMessage = (
		role: string,
		text: string,
	): string =>
		JSON.stringify({
			timestamp: new Date(Date.UTC(2026, 10, 11, 10, 0, seq++)).toISOString(),
			type: "response_item",
			payload: { type: "message", role, content: [{ type: "input_text", text }] },
		});

	writeRollout({
		sessionsRoot: sessions,
		sessionId: "new-format-thread",
		lines: [
			metaLine({ id: "new-format-thread", cwd: "/work/app" }),
			// Injected instructions and inter-agent traffic are not turns.
			responseMessage("user", "# AGENTS.md instructions for /work/app"),
			responseMessage("developer", "<model_switch>use another model"),
			itemCompleted("UserMessage", [{ type: "text", text: "fix the failing test" }]),
			// The same prompt may also appear as a response_item message.
			responseMessage("user", "fix the failing test"),
			itemCompleted("Reasoning", [{ type: "text", text: "internal reasoning" }]),
			itemCompleted("AgentMessage", [
				{ type: "Text", text: "Looking at the test now." },
			]),
			itemCompleted("CommandExecution", [{ type: "text", text: "pnpm test" }]),
			itemCompleted("AgentMessage", [{ type: "Text", text: "Fixed and verified." }]),
		],
	});

	const metas = await codexAdapter.scan();
	const meta = metas.find((entry) => entry.id === "new-format-thread");
	assert.ok(meta);
	const parsed = await codexAdapter.parse(meta);

	assert.deepEqual(
		parsed.messages.map((message) => [message.type, message.content]),
		[
			["user", "fix the failing test"],
			["assistant", "Looking at the test now."],
			["assistant", "Fixed and verified."],
		],
	);
	// The command execution after a reply marks that reply as tool-using.
	assert.equal(parsed.messages[1].hasToolUse, true);
	assert.equal(parsed.messages[2].hasToolUse, false);
	assert.equal(parsed.cwd, "/work/app");
});
