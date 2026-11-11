import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";

// A real WSL distro is running on this machine: disable live discovery so only
// the injected test homes are scanned (see setWslHomesForTesting below).
process.env.CHATCRYSTAL_WSL = "0";

// appConfig is frozen as soon as config.ts is first imported, so point the
// adapter's env var at a fresh fixture root *before* importing the adapter.
const dataDir = mkdtempSync(join(tmpdir(), "cc-copilot-cli-"));
process.env.COPILOT_CLI_DATA_DIR = dataDir;

const { appConfig } = await import("../../config.js");
const { copilotCliAdapter } = await import("./copilot-cli.js");
const { setWslHomesForTesting } = await import("../wsl.js");

after(() => {
	rmSync(dataDir, { recursive: true, force: true });
});

/** Write `session-state/<sessionId>/events.jsonl`; string lines pass through raw. */
function writeEventsFile(
	root: string,
	sessionId: string,
	lines: Array<Record<string, unknown> | string>,
): string {
	const sessionDir = resolve(root, "session-state", sessionId);
	mkdirSync(sessionDir, { recursive: true });
	const filePath = resolve(sessionDir, "events.jsonl");
	const body = `${lines
		.map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
		.join("\n")}\n`;
	writeFileSync(filePath, body, "utf-8");
	return filePath;
}

function conversationMeta(filePath: string, id: string) {
	return {
		id,
		source: "copilot-cli",
		filePath,
		fileSize: statSync(filePath).size,
		fileMtime: "2026-02-02T00:00:00.000Z",
		projectDir: "",
	};
}

const sessionStart = (cwd: string, timestamp: string) => ({
	type: "session.start",
	data: { sessionId: "event-session-id", context: { cwd } },
	timestamp,
});

test("detect and scan discover session event logs", async () => {
	// A data dir with nothing importable is not detected.
	assert.equal(await copilotCliAdapter.detect(), null);

	// A session directory without an events.jsonl is not a conversation.
	mkdirSync(resolve(dataDir, "session-state", "orphan-session"), {
		recursive: true,
	});

	const filePath = writeEventsFile(dataDir, "session-abc", [
		sessionStart("/work/copilot-demo", "2026-01-01T10:00:00.000Z"),
		{
			type: "user.message",
			data: { content: "Hello" },
			timestamp: "2026-01-01T10:00:10.000Z",
		},
	]);

	const info = await copilotCliAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "copilot-cli");
	assert.equal(info.displayName, "Copilot CLI");
	assert.equal(info.dataDir, dataDir);
	assert.equal(info.conversationCount, 1);

	const metas = await copilotCliAdapter.scan();
	assert.equal(metas.length, 1);
	assert.equal(metas[0]?.id, "session-abc");
	assert.equal(metas[0]?.source, "copilot-cli");
	assert.equal(metas[0]?.filePath, filePath);
	assert.equal(metas[0]?.fileSize, statSync(filePath).size);
	assert.equal(metas[0]?.fileMtime, statSync(filePath).mtime.toISOString());
	assert.equal(metas[0]?.projectDir, "");
});

test("parse reconstructs turns, tool usage and timestamps", async () => {
	const root = mkdtempSync(join(tmpdir(), "cc-copilot-cli-parse-"));
	const epochMillis = 1767261645000;
	const filePath = writeEventsFile(root, "sess-dir", [
		sessionStart("C:\\work\\copilot-demo", "2026-01-01T10:00:00.000Z"),
		// No timestamp: falls back to the file mtime.
		{ type: "user.message", data: { content: "  Explain the build  " } },
		{
			type: "user.message",
			data: { content: "Run the build" },
			timestamp: "2026-01-01T10:00:20.000Z",
		},
		{
			type: "assistant.message",
			data: { content: "Here is the plan." },
			timestamp: "2026-01-01T10:00:30.000Z",
		},
		{
			type: "tool.execution_start",
			data: { toolName: "bash", arguments: { command: "pnpm build" } },
			timestamp: "2026-01-01T10:00:31.000Z",
		},
		{
			type: "tool.execution_complete",
			data: { success: true },
			timestamp: "2026-01-01T10:00:40.000Z",
		},
		// Empty assistant content is noise; tool events after it must not
		// retroactively flag the previous assistant turn.
		{
			type: "assistant.message",
			data: { content: "   " },
			timestamp: "2026-01-01T10:00:50.000Z",
		},
		{
			type: "tool.execution_start",
			data: { toolName: "view", arguments: { path: "README.md" } },
			timestamp: "2026-01-01T10:00:51.000Z",
		},
		{
			type: "assistant.message",
			data: { content: "Run:\n```sh\npnpm build\n``` " },
			timestamp: epochMillis,
		},
		{ type: "session.info", data: { infoType: "fork" } },
		"{not valid json",
	]);

	const parsed = await copilotCliAdapter.parse(
		conversationMeta(filePath, "sess-dir"),
	);

	assert.equal(parsed.id, "sess-dir");
	assert.equal(parsed.source, "copilot-cli");
	assert.equal(parsed.slug, null);
	assert.equal(parsed.projectDir, "C:\\work\\copilot-demo");
	assert.equal(parsed.projectName, "copilot-demo");
	assert.equal(parsed.cwd, "C:\\work\\copilot-demo");
	assert.equal(parsed.gitBranch, null);

	assert.equal(parsed.messages.length, 4);
	assert.deepEqual(
		parsed.messages.map((message) => [
			message.type,
			message.role,
			message.content,
		]),
		[
			["user", "user", "Explain the build"],
			["user", "user", "Run the build"],
			["assistant", "assistant", "Here is the plan."],
			["assistant", "assistant", "Run:\n```sh\npnpm build\n```"],
		],
	);

	const [first, , third, fourth] = parsed.messages;
	assert.equal(first?.timestamp, "2026-02-02T00:00:00.000Z");
	assert.equal(first?.id, "sess-dir-0");
	assert.equal(first?.hasToolUse, false);
	assert.equal(first?.hasCode, false);
	assert.equal(first?.thinking, null);

	assert.equal(third?.timestamp, "2026-01-01T10:00:30.000Z");
	assert.equal(third?.id, "sess-dir-2");
	assert.equal(third?.hasToolUse, true);

	assert.equal(fourth?.timestamp, new Date(epochMillis).toISOString());
	assert.equal(fourth?.id, "sess-dir-3");
	assert.equal(fourth?.hasCode, true);
	assert.equal(fourth?.hasToolUse, false);

	assert.equal(parsed.firstMessageAt, "2026-02-02T00:00:00.000Z");
	assert.equal(parsed.lastMessageAt, new Date(epochMillis).toISOString());
});

test("parse tolerates empty and unreadable event content", async () => {
	const root = mkdtempSync(join(tmpdir(), "cc-copilot-cli-empty-"));
	const filePath = writeEventsFile(root, "lonely", [
		"{broken",
		{ type: "user.message", data: {} },
		{ type: "user.message", data: { content: "" } },
		// user.message is the last meaningful record, so import-level filtering
		// of short conversations is the caller's concern.
		{ type: "user.message", data: { content: "Only one turn" } },
		{ type: "tool.execution_start", data: { toolName: "bash" } },
		{ type: "session.shutdown", data: {} },
	]);

	const meta = conversationMeta(filePath, "lonely");
	const parsed = await copilotCliAdapter.parse(meta);

	assert.equal(parsed.id, "lonely");
	assert.equal(parsed.messages.length, 1);
	assert.equal(parsed.messages[0]?.type, "user");
	assert.equal(parsed.messages[0]?.content, "Only one turn");
	assert.equal(parsed.messages[0]?.hasToolUse, false);
	assert.equal(parsed.firstMessageAt, meta.fileMtime);

	// Empty event log: metadata still resolves to file mtime.
	const emptyPath = writeEventsFile(root, "empty-log", []);
	const empty = await copilotCliAdapter.parse(
		conversationMeta(emptyPath, "empty-log"),
	);
	assert.equal(empty.messages.length, 0);
	assert.equal(empty.firstMessageAt, "2026-02-02T00:00:00.000Z");
	assert.equal(empty.cwd, null);
});

test("scans a WSL distro root beside the local data dir", async () => {
	const localRoot = mkdtempSync(join(tmpdir(), "cc-copilot-cli-local-"));
	const wslHome = mkdtempSync(join(tmpdir(), "cc-copilot-cli-wsl-"));
	const wslRoot = join(wslHome, ".copilot");
	appConfig.copilotCliDataDir = localRoot;

	const localPath = writeEventsFile(localRoot, "local-session", [
		sessionStart("C:\\work\\local-copilot", "2026-09-01T09:00:00.000Z"),
		{
			type: "user.message",
			data: { content: "local prompt" },
			timestamp: "2026-09-01T09:00:10.000Z",
		},
	]);
	const wslPath = writeEventsFile(wslRoot, "wsl-session", [
		sessionStart("/home/me/wsl-copilot", "2026-09-02T09:00:00.000Z"),
		{
			type: "user.message",
			data: { content: "wsl prompt" },
			timestamp: "2026-09-02T09:00:10.000Z",
		},
		{
			type: "assistant.message",
			data: { content: "wsl reply" },
			timestamp: "2026-09-02T09:00:20.000Z",
		},
	]);

	setWslHomesForTesting([wslHome]);
	try {
		const info = await copilotCliAdapter.detect();
		assert.ok(info);
		// The reported data dir stays the primary Windows root.
		assert.equal(info.dataDir, localRoot);
		assert.equal(info.conversationCount, 2);

		const metas = await copilotCliAdapter.scan();
		assert.equal(metas.length, 2);

		const local = metas.find((meta) => meta.id === "local-session");
		assert.ok(local);
		assert.equal(local.rootDir, localRoot);
		assert.equal(local.filePath, localPath);

		const wsl = metas.find((meta) => meta.id === "wsl-session");
		assert.ok(wsl);
		assert.equal(wsl.rootDir, wslRoot);
		assert.equal(wsl.filePath, wslPath);

		const parsed = await copilotCliAdapter.parse(wsl);
		assert.equal(parsed.id, wsl.id);
		assert.equal(parsed.cwd, "/home/me/wsl-copilot");
		assert.equal(parsed.projectName, "wsl-copilot");
		assert.deepEqual(
			parsed.messages.map((message) => [message.type, message.content]),
			[
				["user", "wsl prompt"],
				["assistant", "wsl reply"],
			],
		);
	} finally {
		setWslHomesForTesting(null);
		appConfig.copilotCliDataDir = dataDir;
		rmSync(localRoot, { recursive: true, force: true });
		rmSync(wslHome, { recursive: true, force: true });
	}
});

test("watchPaths returns the events glob", () => {
	assert.deepEqual(copilotCliAdapter.watchPaths?.(), [
		resolve(dataDir, "session-state", "**", "events.jsonl"),
	]);
});
