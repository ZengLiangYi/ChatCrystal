import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";

// appConfig is frozen as soon as config.ts is first imported, so point the
// adapter's env var at a fresh fixture root *before* importing the adapter.
const dataDir = mkdtempSync(join(tmpdir(), "cc-droid-"));
const wslHome = mkdtempSync(join(tmpdir(), "cc-droid-wsl-home-"));
process.env.DROID_DATA_DIR = dataDir;
// Keep the developer's real WSL distros out of these fixtures; the WSL test
// injects its own home through setWslHomesForTesting().
process.env.CHATCRYSTAL_WSL = "0";

const { droidAdapter } = await import("./droid.js");
const { setWslHomesForTesting } = await import("../wsl.js");

after(() => {
	setWslHomesForTesting(null);
	rmSync(dataDir, { recursive: true, force: true });
	rmSync(wslHome, { recursive: true, force: true });
});

/** Write a transcript relative to `root`; string lines pass through raw. */
function writeTranscript(
	root: string,
	relativePath: string,
	lines: Array<Record<string, unknown> | string>,
): string {
	const filePath = resolve(root, relativePath);
	mkdirSync(dirname(filePath), { recursive: true });
	const body = `${lines
		.map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
		.join("\n")}\n`;
	writeFileSync(filePath, body, "utf-8");
	return filePath;
}

function conversationMeta(filePath: string, id: string, projectDir = "") {
	return {
		id,
		source: "droid",
		filePath,
		fileSize: statSync(filePath).size,
		fileMtime: "2026-03-03T00:00:00.000Z",
		projectDir,
	};
}

test("detect and scan read one- and two-level session layouts", async () => {
	assert.equal(await droidAdapter.detect(), null);

	// Older layout: sessions/<id>.jsonl, straight in the sessions folder.
	const legacyPath = writeTranscript(dataDir, "sessions/legacy.jsonl", [
		{
			type: "session_start",
			id: "droid-legacy-1",
			title: "Legacy layout",
			cwd: "/work/one",
		},
		{
			type: "message",
			message: { role: "user", content: "Hi" },
		},
	]);

	// Newer layout: sessions/<cwd-encoded>/<id>.jsonl with a settings sidecar.
	const nestedPath = writeTranscript(
		dataDir,
		"sessions/c--work-two/nested.jsonl",
		[
			{
				type: "session_start",
				id: "droid-nested-2",
				title: "New Session",
				cwd: "C:\\old\\two",
				lastCwd: "C:\\work\\two",
			},
			{
				type: "message",
				message: { role: "assistant", content: "Hello" },
			},
		],
	);
	writeFileSync(
		resolve(dataDir, "sessions/c--work-two/nested.settings.json"),
		"{}",
		"utf-8",
	);

	// A transcript whose header cannot be parsed falls back to its file name.
	const brokenPath = writeTranscript(dataDir, "sessions/broken.jsonl", [
		"{not valid json",
		{ type: "message", message: { role: "user", content: "Hi" } },
	]);

	// Transcriptions are only looked for one and two levels below sessions/.
	writeTranscript(dataDir, "sessions/too/deep/hidden.jsonl", [
		{ type: "session_start", id: "droid-deep", cwd: "/work/deep" },
		{ type: "message", message: { role: "user", content: "Hi" } },
	]);

	const info = await droidAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "droid");
	assert.equal(info.displayName, "Factory Droid");
	assert.equal(info.dataDir, dataDir);
	assert.equal(info.conversationCount, 3);

	const metas = await droidAdapter.scan();
	assert.equal(metas.length, 3);
	assert.deepEqual(
		metas.map((meta) => meta.id).sort(),
		["broken", "droid-legacy-1", "droid-nested-2"],
	);
	for (const meta of metas) {
		assert.equal(meta.source, "droid");
		assert.ok(meta.fileSize > 0);
		assert.ok(!Number.isNaN(Date.parse(meta.fileMtime)));
	}

	const legacy = metas.find((meta) => meta.id === "droid-legacy-1");
	assert.equal(legacy?.filePath, legacyPath);
	assert.equal(legacy?.projectDir, "/work/one");

	const nested = metas.find((meta) => meta.id === "droid-nested-2");
	assert.equal(nested?.filePath, nestedPath);
	// lastCwd wins over the original cwd.
	assert.equal(nested?.projectDir, "C:\\work\\two");

	const broken = metas.find((meta) => meta.id === "broken");
	assert.equal(broken?.filePath, brokenPath);
	assert.equal(broken?.projectDir, "");
});

test("parse reconstructs messages, thinking, tool use and project metadata", async () => {
	const root = mkdtempSync(join(tmpdir(), "cc-droid-parse-"));
	const filePath = writeTranscript(root, "sessions/full.jsonl", [
		{
			type: "session_start",
			id: "droid-parse-1",
			title: "Fix the parser",
			cwd: "/old/cwd",
			lastCwd: "/work/demo",
		},
		{
			type: "message",
			id: "msg-user-1",
			timestamp: "2026-03-03T10:00:00.000Z",
			message: { role: "user", content: "  Please fix the parser  " },
		},
		{
			type: "message",
			timestamp: "2026-03-03T10:00:10.000Z",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "We need a plan." },
					{ type: "text", text: "Sure." },
					{ type: "tool_use", id: "tool-1", name: "Read", input: {} },
				],
			},
		},
		// Tool output is not conversation text.
		{
			type: "message",
			timestamp: "2026-03-03T10:00:11.000Z",
			message: {
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tool-1" }],
			},
		},
		// Droid-injected context starts with "<" and is noise.
		{
			type: "message",
			timestamp: "2026-03-03T10:00:12.000Z",
			message: {
				role: "user",
				content:
					"<system-notification>environment context</system-notification>",
			},
		},
		{
			type: "message",
			timestamp: "2026-03-03T10:00:20.000Z",
			message: {
				role: "assistant",
				content: [{ type: "thinking", thinking: "Only thinking" }],
			},
		},
		{
			type: "message",
			timestamp: "2026-03-03T10:00:30.000Z",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Run:\n```ts\ncode()\n```" }],
			},
		},
		{
			type: "message",
			timestamp: "2026-03-03T10:00:40.000Z",
			message: { role: "user", content: "   " },
		},
		{
			type: "message",
			timestamp: "2026-03-03T10:00:50.000Z",
			message: {
				role: "assistant",
				content: [{ type: "tool_use", id: "tool-2", name: "Bash" }],
			},
		},
		"{malformed",
		// No timestamp: falls back to the transcript mtime.
		{
			type: "message",
			message: { role: "user", content: "No time" },
		},
	]);

	const meta = conversationMeta(filePath, "droid-parse-1");
	const parsed = await droidAdapter.parse(meta);

	assert.equal(parsed.id, "droid-parse-1");
	assert.equal(parsed.source, "droid");
	assert.equal(parsed.slug, "Fix the parser");
	assert.equal(parsed.projectDir, "/work/demo");
	assert.equal(parsed.projectName, "demo");
	assert.equal(parsed.cwd, "/work/demo");
	assert.equal(parsed.gitBranch, null);

	assert.equal(parsed.messages.length, 6);
	assert.deepEqual(
		parsed.messages.map((message) => [message.type, message.role]),
		[
			["user", "user"],
			["assistant", "assistant"],
			["assistant", "assistant"],
			["assistant", "assistant"],
			["assistant", "assistant"],
			["user", "user"],
		],
	);

	const [user, reply, thinkingOnly, codeReply, toolOnly, noTime] =
		parsed.messages;
	assert.equal(user?.id, "msg-user-1");
	assert.equal(user?.content, "Please fix the parser");
	assert.equal(user?.timestamp, "2026-03-03T10:00:00.000Z");
	assert.equal(user?.hasToolUse, false);

	assert.equal(reply?.id, "droid-parse-1-1");
	assert.equal(reply?.content, "Sure.");
	assert.equal(reply?.thinking, "We need a plan.");
	assert.equal(reply?.hasToolUse, true);
	assert.equal(reply?.hasCode, false);
	assert.equal(reply?.timestamp, "2026-03-03T10:00:10.000Z");

	assert.equal(thinkingOnly?.content, "");
	assert.equal(thinkingOnly?.thinking, "Only thinking");
	assert.equal(thinkingOnly?.hasToolUse, false);

	assert.equal(codeReply?.hasCode, true);
	assert.equal(codeReply?.content, "Run:\n```ts\ncode()\n```");

	assert.equal(toolOnly?.content, "");
	assert.equal(toolOnly?.hasToolUse, true);
	assert.equal(toolOnly?.type, "assistant");

	assert.equal(noTime?.content, "No time");
	assert.equal(noTime?.timestamp, "2026-03-03T00:00:00.000Z");
	assert.equal(noTime?.id, "droid-parse-1-5");

	assert.equal(parsed.firstMessageAt, "2026-03-03T10:00:00.000Z");
	assert.equal(parsed.lastMessageAt, "2026-03-03T00:00:00.000Z");
});

test("parse falls back when the header is missing or the title is a placeholder", async () => {
	const root = mkdtempSync(join(tmpdir(), "cc-droid-fallback-"));

	// No session_start: metadata comes from the ConversationMeta.
	const noHeaderPath = writeTranscript(root, "sessions/no-header.jsonl", [
		{ type: "message", message: { role: "user", content: "Hi" } },
		{ type: "message", message: { role: "assistant", content: "Hello" } },
	]);
	const noHeader = await droidAdapter.parse(
		conversationMeta(noHeaderPath, "no-header", "/work/fallback"),
	);
	assert.equal(noHeader.id, "no-header");
	assert.equal(noHeader.slug, null);
	assert.equal(noHeader.projectDir, "/work/fallback");
	assert.equal(noHeader.cwd, "/work/fallback");
	assert.equal(noHeader.messages.length, 2);

	// Droid's default title means "untitled".
	const untitledPath = writeTranscript(root, "sessions/untitled.jsonl", [
		{
			type: "session_start",
			id: "untitled",
			title: "New Session",
			cwd: "/work/demo",
		},
		{ type: "message", message: { role: "user", content: "Hi" } },
	]);
	const untitled = await droidAdapter.parse(
		conversationMeta(untitledPath, "untitled"),
	);
	assert.equal(untitled.slug, null);

	// Empty transcript: metadata still resolves from the file mtime.
	const emptyPath = resolve(root, "sessions/empty.jsonl");
	writeFileSync(emptyPath, "", "utf-8");
	const empty = await droidAdapter.parse(
		conversationMeta(emptyPath, "empty", "/work/empty"),
	);
	assert.equal(empty.id, "empty");
	assert.equal(empty.messages.length, 0);
	assert.equal(empty.slug, null);
	assert.equal(empty.projectDir, "/work/empty");
	assert.equal(empty.firstMessageAt, "2026-03-03T00:00:00.000Z");
});

test("detect, scan and parse include sessions from a WSL distro home", async () => {
	// Start from an empty local root so the count is fully determined here.
	rmSync(dataDir, { recursive: true, force: true });
	mkdirSync(dataDir, { recursive: true });
	const localPath = writeTranscript(dataDir, "sessions/local-session.jsonl", [
		{
			type: "session_start",
			id: "droid-local-1",
			cwd: "/work/local",
		},
		{
			type: "message",
			timestamp: "2026-03-04T09:00:01.000Z",
			message: { role: "user", content: "local question" },
		},
	]);

	// The same `<root>/sessions/**` layout inside the WSL distro home.
	const wslRoot = join(wslHome, ".factory");
	const wslPath = writeTranscript(wslRoot, "sessions/wsl-session.jsonl", [
		{
			type: "session_start",
			id: "droid-wsl-1",
			title: "WSL session",
			cwd: "/home/wsl-user/code/old",
			lastCwd: "/home/wsl-user/code/wsl-app",
		},
		{
			type: "message",
			timestamp: "2026-03-04T10:00:01.000Z",
			message: { role: "user", content: "wsl question" },
		},
		{
			type: "message",
			timestamp: "2026-03-04T10:00:02.000Z",
			message: { role: "assistant", content: "wsl answer" },
		},
	]);

	setWslHomesForTesting([wslHome]);
	try {
		const info = await droidAdapter.detect();
		assert.ok(info);
		assert.equal(info.dataDir, dataDir);
		// One conversation locally plus one inside the WSL distro home.
		assert.equal(info.conversationCount, 2);

		const metas = await droidAdapter.scan();
		assert.equal(metas.length, 2);
		const local = metas.find((meta) => meta.id === "droid-local-1");
		assert.ok(local);
		assert.equal(local.filePath, localPath);
		assert.equal(local.rootDir, dataDir);

		const wsl = metas.find((meta) => meta.id === "droid-wsl-1");
		assert.ok(wsl);
		assert.equal(wsl.rootDir, wslRoot);
		assert.equal(wsl.filePath, wslPath);
		assert.ok(wsl.filePath.startsWith(wslHome));
		assert.equal(wsl.projectDir, "/home/wsl-user/code/wsl-app");

		const parsed = await droidAdapter.parse(wsl);
		assert.equal(parsed.id, "droid-wsl-1");
		assert.equal(parsed.slug, "WSL session");
		assert.equal(parsed.projectDir, "/home/wsl-user/code/wsl-app");
		assert.deepEqual(
			parsed.messages.map((message) => [message.type, message.content]),
			[
				["user", "wsl question"],
				["assistant", "wsl answer"],
			],
		);

		// WSL roots are not watched: the watcher only tracks local Windows paths.
		const watched = droidAdapter.watchPaths?.() ?? [];
		for (const path of watched) assert.ok(!path.startsWith(wslHome));
	} finally {
		setWslHomesForTesting(null);
	}
});

test("watchPaths returns the sessions glob", () => {
	assert.deepEqual(droidAdapter.watchPaths?.(), [
		resolve(dataDir, "sessions", "**", "*.jsonl"),
	]);
});

