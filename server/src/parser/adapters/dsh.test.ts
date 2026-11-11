import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { zstdCompressSync } from "node:zlib";

// A real WSL distro is running on this machine: disable live discovery so only
// the injected test homes are scanned (see setWslHomesForTesting below).
process.env.CHATCRYSTAL_WSL = "0";

// appConfig resolves its data dirs when the config module is first imported, so
// the fixture root has to be in the environment before that. Each test then
// points appConfig at its own temporary sessions dir.
const baseDir = mkdtempSync(join(tmpdir(), "chatcrystal-dsh-"));
process.env.DSH_SESSIONS_DIR = baseDir;

const { appConfig } = await import("../../config.js");
const { dshAdapter } = await import("./dsh.js");
const { setWslHomesForTesting } = await import("../wsl.js");

const SESSION_DIR = "session-11111111-1111-1111-1111-111111111111";
const CWD = "C:\\Users\\me\\projects\\demo-project";
const HEADER_TIME = 1750000000000;

function useSessionsDir(): string {
	const dir = mkdtempSync(join(baseDir, "sessions-"));
	appConfig.dshSessionsDir = dir;
	return dir;
}

interface WriteSessionOptions {
	root: string;
	project?: string;
	sessionDir?: string;
	version?: number | null;
	zstd?: boolean;
	lines: string[];
}

function writeSession(options: WriteSessionOptions): string {
	const projectDir = join(options.root, options.project ?? "--C-Users-me-projects-demo-project--");
	const sessionDir = join(projectDir, options.sessionDir ?? SESSION_DIR);
	mkdirSync(sessionDir, { recursive: true });

	const suffix = options.zstd ? ".zstd" : "";
	const name =
		options.version === null || options.version === undefined
			? `session.jsonl${suffix}`
			: `session.v${options.version}.jsonl${suffix}`;
	const filePath = join(sessionDir, name);

	if (options.zstd) {
		// One zstd frame per "append batch", the way dsh writes them.
		const buffer = Buffer.concat(
			options.lines.map((line) => zstdCompressSync(Buffer.from(`${line}\n`, "utf8"))),
		);
		writeFileSync(filePath, buffer);
	} else {
		writeFileSync(filePath, `${options.lines.join("\n")}\n`);
	}

	return filePath;
}

function headerLine(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		type: "session",
		version: 4,
		id: SESSION_DIR,
		createdAt: HEADER_TIME,
		cwd: CWD,
		...overrides,
	});
}

function isoAt(ms: number): string {
	return new Date(ms).toISOString();
}

test.after(() => {
	rmSync(baseDir, { recursive: true, force: true });
});

test("detect returns null when the sessions dir is missing or empty", async () => {
	appConfig.dshSessionsDir = join(baseDir, "does-not-exist");
	assert.equal(await dshAdapter.detect(), null);

	const root = useSessionsDir();
	// A project folder without any session folder is not a source.
	mkdirSync(join(root, "--empty-project--"), { recursive: true });
	assert.equal(await dshAdapter.detect(), null);
});

test("detect reports the session count and data dir", async () => {
	const root = useSessionsDir();
	writeSession({ root, lines: [headerLine()] });
	writeSession({
		root,
		project: "--C-Users-me-other--",
		sessionDir: "session-22222222-2222-2222-2222-222222222222",
		lines: [JSON.stringify({ type: "session", version: 4, cwd: CWD })],
	});

	const info = await dshAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "dsh");
	assert.equal(info.displayName, "DeepSeek Harness");
	assert.equal(info.dataDir, root);
	assert.equal(info.conversationCount, 2);
});

test("scan returns the session dir name as id and the newest generation file", async () => {
	const root = useSessionsDir();
	writeSession({ root, version: 3, lines: [headerLine()] });
	const newestPath = writeSession({ root, version: 4, lines: [headerLine()] });
	writeSession({
		root,
		project: "--C-Users-me-plain--",
		sessionDir: "session-33333333-3333-3333-3333-333333333333",
		version: null,
		lines: [headerLine()],
	});

	const metas = await dshAdapter.scan();
	assert.equal(metas.length, 2);

	const meta = metas.find((entry) => entry.id === SESSION_DIR);
	assert.ok(meta);
	assert.equal(meta.source, "dsh");
	assert.equal(meta.filePath, newestPath);
	assert.ok(meta.fileSize > 0);
	assert.ok(!Number.isNaN(Date.parse(meta.fileMtime)));

	const plain = metas.find(
		(entry) => entry.id === "session-33333333-3333-3333-3333-333333333333",
	);
	assert.ok(plain);
	assert.match(plain.filePath, /session\.jsonl$/);
});

test("parse reconstructs the conversation and drops harness-injected messages", async () => {
	const root = useSessionsDir();
	const filePath = writeSession({
		root,
		lines: [
			headerLine(),
			// Harness-injected user-role messages: not what the person typed.
			JSON.stringify({
				type: "user/message",
				seq: 2,
				time: HEADER_TIME + 10,
				data: {
					content: [{ type: "text", text: "Approval policy changed" }],
					source: { kind: "user-approval" },
					role: "user",
					id: "approval-1",
				},
			}),
			JSON.stringify({
				type: "user/message",
				seq: 3,
				time: HEADER_TIME + 20,
				data: {
					content: [{ type: "text", text: "Runtime context snapshot" }],
					source: { kind: "runtime-context" },
					role: "user",
					id: "runtime-1",
				},
			}),
			JSON.stringify({
				type: "user/message",
				seq: 4,
				time: HEADER_TIME + 1000,
				data: {
					content: [
						{
							type: "text",
							text: "Fix the failing build\n<system-reminder>ignore me</system-reminder>",
						},
					],
					source: { kind: "user" },
					role: "user",
					id: "user-msg-1",
				},
			}),
			JSON.stringify({
				type: "assistant/message",
				seq: 5,
				time: HEADER_TIME + 2000,
				data: {
					message: {
						role: "assistant",
						id: "assistant-record-id",
						content: [
							{ type: "reasoning", text: "The build fails on a type error." },
							{ type: "text", text: "Apply this patch:\n```ts\nconst x = 1;\n```" },
							{ type: "tool-call", id: "call-1", name: "bash", arguments: "{}" },
						],
					},
				},
			}),
			JSON.stringify({
				type: "tool/call",
				seq: 6,
				time: HEADER_TIME + 3000,
				data: { callId: "call-1", name: "bash", arguments: "{}" },
			}),
			JSON.stringify({
				type: "tool/result",
				seq: 7,
				time: HEADER_TIME + 4000,
				data: { content: [{ type: "text", text: "tool output noise" }] },
			}),
			JSON.stringify({
				type: "session/title",
				seq: 8,
				time: HEADER_TIME + 5000,
				data: { title: "Fix the failing build", source: { kind: "fallback" } },
			}),
			JSON.stringify({
				type: "session/title",
				seq: 9,
				time: HEADER_TIME + 6000,
				data: { title: "Fix the build properly", source: { kind: "provider" } },
			}),
			// A subagent fallback title cut from injected context is not usable.
			JSON.stringify({
				type: "session/title",
				seq: 91,
				time: HEADER_TIME + 6500,
				data: {
					title: '<system-reminder> You are teammate "verifier',
					source: { kind: "fallback" },
				},
			}),
			JSON.stringify({
				type: "assistant/message",
				seq: 10,
				time: HEADER_TIME + 7000,
				data: {
					message: {
						role: "assistant",
						content: [{ type: "text", text: "The patch is applied." }],
					},
				},
			}),
			// A malformed/truncated trailing line must not break the parse.
			'{"type":"assistant/message","seq":11,"data":{"message":{"content":',
		],
	});

	const meta = (await dshAdapter.scan())[0];
	assert.ok(meta);
	assert.equal(meta.filePath, filePath);

	const parsed = await dshAdapter.parse(meta);
	assert.equal(parsed.id, SESSION_DIR);
	assert.equal(parsed.source, "dsh");
	assert.equal(parsed.cwd, CWD);
	assert.equal(parsed.projectDir, CWD);
	assert.equal(parsed.projectName, "demo-project");
	// The second (model generated) title wins.
	assert.equal(parsed.slug, "Fix the build properly");
	assert.equal(parsed.gitBranch, null);

	assert.equal(parsed.messages.length, 3);
	const [userMessage, assistantMessage, finalMessage] = parsed.messages;
	assert.ok(userMessage && assistantMessage && finalMessage);

	assert.equal(userMessage.type, "user");
	assert.equal(userMessage.role, "user");
	assert.equal(userMessage.id, "user-msg-1");
	assert.equal(userMessage.content, "Fix the failing build");
	assert.equal(userMessage.thinking, null);
	assert.equal(userMessage.hasToolUse, false);
	assert.equal(userMessage.timestamp, isoAt(HEADER_TIME + 1000));

	assert.equal(assistantMessage.type, "assistant");
	assert.equal(assistantMessage.id, `${SESSION_DIR}-a-5`);
	assert.equal(assistantMessage.content, "Apply this patch:\n```ts\nconst x = 1;\n```");
	assert.equal(assistantMessage.thinking, "The build fails on a type error.");
	assert.equal(assistantMessage.hasToolUse, true);
	assert.equal(assistantMessage.hasCode, true);
	assert.equal(assistantMessage.timestamp, isoAt(HEADER_TIME + 2000));

	assert.equal(finalMessage.content, "The patch is applied.");
	assert.equal(finalMessage.hasToolUse, false);

	assert.equal(parsed.firstMessageAt, isoAt(HEADER_TIME + 1000));
	assert.equal(parsed.lastMessageAt, isoAt(HEADER_TIME + 7000));
});

test("parse reads multi-frame zstd session files", async () => {
	const root = useSessionsDir();
	writeSession({
		root,
		version: 4,
		zstd: true,
		lines: [
			headerLine(),
			JSON.stringify({
				type: "user/message",
				seq: 2,
				time: HEADER_TIME + 1000,
				data: {
					content: [{ type: "text", text: "zipped prompt" }],
					source: { kind: "user" },
					id: "u-1",
				},
			}),
			JSON.stringify({
				type: "assistant/message",
				seq: 3,
				time: HEADER_TIME + 2000,
				data: {
					message: { content: [{ type: "text", text: "zipped answer" }] },
				},
			}),
		],
	});

	const metas = await dshAdapter.scan();
	assert.equal(metas.length, 1);
	assert.match(metas[0]?.filePath ?? "", /session\.v4\.jsonl\.zstd$/);

	const parsed = await dshAdapter.parse(metas[0] as (typeof metas)[number]);
	assert.deepEqual(
		parsed.messages.map((message) => [message.type, message.content]),
		[
			["user", "zipped prompt"],
			["assistant", "zipped answer"],
		],
	);
});

test("parse falls back to the header timestamp for messages without a time", async () => {
	const root = useSessionsDir();
	writeSession({
		root,
		lines: [
			headerLine(),
			JSON.stringify({
				type: "user/message",
				data: {
					content: [{ type: "text", text: "no timestamp here" }],
					source: { kind: "user" },
				},
			}),
		],
	});

	const meta = (await dshAdapter.scan())[0];
	assert.ok(meta);
	const parsed = await dshAdapter.parse(meta);
	assert.equal(parsed.messages[0]?.timestamp, isoAt(HEADER_TIME));
	assert.equal(parsed.messages[0]?.id, `${SESSION_DIR}-u-0`);
});

test("scans WSL distro session roots beside the local sessions dir", async () => {
	const localRoot = useSessionsDir();
	const wslHome = mkdtempSync(join(baseDir, "wsl-home-"));
	const wslRoot = join(wslHome, ".dsh", "sessions");

	writeSession({ root: localRoot, lines: [headerLine()] });

	const wslSessionDir = "session-44444444-4444-4444-4444-444444444444";
	const wslCwd = "/home/me/wsl-project";
	const wslFilePath = writeSession({
		root: wslRoot,
		project: "--home-me-wsl-project--",
		sessionDir: wslSessionDir,
		lines: [
			headerLine({ id: wslSessionDir, cwd: wslCwd }),
			JSON.stringify({
				type: "user/message",
				seq: 2,
				time: HEADER_TIME + 1000,
				data: {
					content: [{ type: "text", text: "wsl prompt" }],
					source: { kind: "user" },
					id: "wsl-u1",
				},
			}),
			JSON.stringify({
				type: "assistant/message",
				seq: 3,
				time: HEADER_TIME + 2000,
				data: { message: { content: [{ type: "text", text: "wsl answer" }] } },
			}),
		],
	});

	setWslHomesForTesting([wslHome]);
	try {
		const info = await dshAdapter.detect();
		assert.ok(info);
		// The reported data dir stays the primary Windows root.
		assert.equal(info.dataDir, localRoot);
		assert.equal(info.conversationCount, 2);

		const metas = await dshAdapter.scan();
		assert.equal(metas.length, 2);

		const local = metas.find((meta) => meta.id === SESSION_DIR);
		assert.ok(local);
		assert.equal(local.rootDir, localRoot);

		const wsl = metas.find((meta) => meta.id === wslSessionDir);
		assert.ok(wsl);
		assert.equal(wsl.rootDir, wslRoot);
		assert.equal(wsl.filePath, wslFilePath);

		const parsed = await dshAdapter.parse(wsl);
		assert.equal(parsed.id, wslSessionDir);
		assert.equal(parsed.cwd, wslCwd);
		assert.equal(parsed.projectName, "wsl-project");
		assert.deepEqual(
			parsed.messages.map((message) => [message.type, message.content]),
			[
				["user", "wsl prompt"],
				["assistant", "wsl answer"],
			],
		);
	} finally {
		setWslHomesForTesting(null);
	}
});

test("watchPaths targets session files below the sessions dir", () => {
	const root = useSessionsDir();
	assert.deepEqual(dshAdapter.watchPaths?.(), [
		resolve(root, "**/session*.jsonl*"),
	]);
});
