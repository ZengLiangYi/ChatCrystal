import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import initSqlJs from "sql.js";

// A real WSL distro is running on this machine: disable live discovery so only
// the injected test homes are scanned (see setWslHomesForTesting below).
process.env.CHATCRYSTAL_WSL = "0";

// appConfig resolves its data dirs when the config module is first imported, so
// the fixture root has to be in the environment before that. Each test then
// points appConfig at its own temporary Antigravity data dir.
const baseDir = mkdtempSync(join(tmpdir(), "chatcrystal-antigravity-"));
process.env.ANTIGRAVITY_DATA_DIR = baseDir;

const { appConfig } = await import("../../config.js");
const { antigravityAdapter } = await import("./antigravity.js");
const { setWslHomesForTesting } = await import("../wsl.js");

const CONVERSATION_ID = "218f4f83-18c2-401d-b5cd-3ff01987f485";

function useDataDir(): string {
	const dir = mkdtempSync(join(baseDir, "data-"));
	appConfig.antigravityDataDir = dir;
	return dir;
}

function writeTranscript(options: {
	dataDir: string;
	conversationId?: string;
	fileName?: "transcript.jsonl" | "transcript_full.jsonl";
	lines: string[];
}): string {
	const conversationId = options.conversationId ?? CONVERSATION_ID;
	const logsDir = join(
		options.dataDir,
		"brain",
		conversationId,
		".system_generated",
		"logs",
	);
	mkdirSync(logsDir, { recursive: true });
	const filePath = join(logsDir, options.fileName ?? "transcript.jsonl");
	writeFileSync(filePath, `${options.lines.join("\n")}\n`);
	return filePath;
}

async function writeSummariesDb(options: {
	dataDir: string;
	rows: {
		conversationId: string;
		title: string | null;
		workspaceUris: string[];
	}[];
}): Promise<void> {
	const SQL = await initSqlJs();
	const db = new SQL.Database();
	db.run(
		"CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, workspace_uris TEXT)",
	);
	for (const row of options.rows) {
		db.run(
			"INSERT INTO conversation_summaries (conversation_id, title, workspace_uris) VALUES (?, ?, ?)",
			[row.conversationId, row.title, JSON.stringify(row.workspaceUris)],
		);
	}
	writeFileSync(
		join(options.dataDir, "conversation_summaries.db"),
		Buffer.from(db.export()),
	);
	db.close();
}

function stepLine(step: Record<string, unknown>): string {
	return JSON.stringify(step);
}

test.after(() => {
	rmSync(baseDir, { recursive: true, force: true });
});

test("detect returns null when there is no brain or no transcript", async () => {
	appConfig.antigravityDataDir = join(baseDir, "missing-data");
	assert.equal(await antigravityAdapter.detect(), null);

	const dir = useDataDir();
	// A conversation folder without the generated logs is not a conversation.
	mkdirSync(join(dir, "brain", CONVERSATION_ID, "artifacts"), { recursive: true });
	assert.equal(await antigravityAdapter.detect(), null);
});

test("detect reports every conversation with a transcript", async () => {
	const dir = useDataDir();
	writeTranscript({ dataDir: dir, lines: [stepLine({ step_index: 0 })] });
	writeTranscript({
		dataDir: dir,
		conversationId: "27d0feb8-bc47-4946-b729-7e36b98c8897",
		fileName: "transcript_full.jsonl",
		lines: [stepLine({ step_index: 0 })],
	});
	// Empty/stray folders are ignored.
	mkdirSync(join(dir, "brain", "not-a-conversation"), { recursive: true });

	const info = await antigravityAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "antigravity");
	assert.equal(info.displayName, "Antigravity");
	assert.equal(info.dataDir, dir);
	assert.equal(info.conversationCount, 2);
});

test("scan prefers transcript.jsonl and falls back to transcript_full.jsonl", async () => {
	const dir = useDataDir();
	const primaryPath = writeTranscript({
		dataDir: dir,
		lines: [stepLine({ step_index: 0 })],
	});
	writeTranscript({
		dataDir: dir,
		fileName: "transcript_full.jsonl",
		lines: [stepLine({ step_index: 0 })],
	});
	const fullOnlyPath = writeTranscript({
		dataDir: dir,
		conversationId: "2d205d59-8d57-4310-8547-cafe7961cc4e",
		fileName: "transcript_full.jsonl",
		lines: [stepLine({ step_index: 0 })],
	});

	const metas = await antigravityAdapter.scan();
	assert.equal(metas.length, 2);

	const primary = metas.find((meta) => meta.id === CONVERSATION_ID);
	assert.ok(primary);
	assert.equal(primary.source, "antigravity");
	assert.equal(primary.filePath, primaryPath);
	assert.ok(primary.fileSize > 0);
	assert.ok(!Number.isNaN(Date.parse(primary.fileMtime)));

	const fallback = metas.find(
		(meta) => meta.id === "2d205d59-8d57-4310-8547-cafe7961cc4e",
	);
	assert.ok(fallback);
	assert.equal(fallback.filePath, fullOnlyPath);
	assert.match(fallback.filePath, /transcript_full\.jsonl$/);
});

test("parse keeps user and planner steps, cleans injected metadata and reads the summary DB", async () => {
	const dir = useDataDir();
	await writeSummariesDb({
		dataDir: dir,
		rows: [
			{
				conversationId: CONVERSATION_ID,
				title: "Fix the login bug",
				workspaceUris: ["file:///c%3A/Users/me/repo/demo"],
			},
		],
	});
	writeTranscript({
		dataDir: dir,
		lines: [
			stepLine({
				step_index: 0,
				source: "USER_EXPLICIT",
				type: "USER_INPUT",
				status: "DONE",
				created_at: "2026-07-17T09:00:00Z",
				content: [
					"<USER_REQUEST>",
					"Fix the login bug",
					"</USER_REQUEST>",
					"<ADDITIONAL_METADATA>",
					"The current local time is: 2026-07-17T17:00:00+08:00.",
					"The user has uploaded 1 image(s).",
					"</ADDITIONAL_METADATA>",
					"<USER_SETTINGS_CHANGE>",
					"The user changed setting `Model Selection`.",
					"</USER_SETTINGS_CHANGE>",
				].join("\n"),
			}),
			stepLine({
				step_index: 1,
				source: "SYSTEM_SDK",
				type: "EPHEMERAL_MESSAGE",
				status: "DONE",
				created_at: "2026-07-17T09:00:01Z",
				content: "The Data Agent Kit plugin needs to be configured.",
			}),
			stepLine({
				step_index: 2,
				source: "MODEL",
				type: "PLANNER_RESPONSE",
				status: "DONE",
				created_at: "2026-07-17T17:00:02+08:00",
				content: "I'll inspect the login flow first.",
				thinking: "The bug is probably in the auth guard.",
				tool_calls: [{ name: "run_command", args: {} }],
			}),
			stepLine({
				step_index: 3,
				source: "MODEL",
				type: "GENERIC",
				status: "DONE",
				created_at: "2026-07-17T09:00:03Z",
				content: "Created At: ...\nCommand exited with code 0.\nCommand output:\nnoise",
			}),
			stepLine({
				step_index: 4,
				source: "USER_EXPLICIT",
				type: "USER_INPUT",
				status: "DONE",
				created_at: "2026-07-17T09:00:04Z",
				content: "Thanks, apply the fix.",
			}),
			stepLine({
				step_index: 5,
				source: "MODEL",
				type: "PLANNER_RESPONSE",
				status: "DONE",
				created_at: "2026-07-17T09:00:05Z",
				content: "Patch applied.",
				thinking: "",
			}),
			stepLine({
				step_index: 6,
				source: "MODEL",
				type: "PLANNER_RESPONSE",
				status: "DONE",
				created_at: "2026-07-17T09:00:06Z",
				thinking: "Only a thought was recorded for this step.",
			}),
			'{"step_index":7,"type":"PLANNER_RESPONSE","content":"truncated',
		],
	});

	const meta = (await antigravityAdapter.scan())[0];
	assert.ok(meta);
	const parsed = await antigravityAdapter.parse(meta);

	assert.equal(parsed.id, CONVERSATION_ID);
	assert.equal(parsed.source, "antigravity");
	assert.equal(parsed.slug, "Fix the login bug");
	assert.equal(parsed.cwd, "C:/Users/me/repo/demo");
	assert.equal(parsed.projectDir, "C:/Users/me/repo/demo");
	assert.equal(parsed.projectName, "demo");
	assert.equal(parsed.gitBranch, null);

	assert.deepEqual(
		parsed.messages.map((message) => message.type),
		["user", "assistant", "user", "assistant", "assistant"],
	);

	const [firstUser, firstAssistant, secondUser, secondAssistant, thinkingOnly] =
		parsed.messages;
	assert.ok(
		firstUser && firstAssistant && secondUser && secondAssistant && thinkingOnly,
	);

	assert.equal(firstUser.id, `${CONVERSATION_ID}-step-0`);
	assert.equal(firstUser.content, "Fix the login bug");
	assert.equal(firstUser.timestamp, "2026-07-17T09:00:00.000Z");

	assert.equal(firstAssistant.id, `${CONVERSATION_ID}-step-2`);
	assert.equal(firstAssistant.content, "I'll inspect the login flow first.");
	assert.equal(firstAssistant.thinking, "The bug is probably in the auth guard.");
	assert.equal(firstAssistant.hasToolUse, true);
	assert.equal(firstAssistant.hasCode, false);
	// The +08:00 timestamp is normalized to UTC ISO.
	assert.equal(firstAssistant.timestamp, "2026-07-17T09:00:02.000Z");

	assert.equal(secondUser.content, "Thanks, apply the fix.");
	assert.equal(secondAssistant.content, "Patch applied.");
	assert.equal(secondAssistant.hasToolUse, false);
	assert.equal(secondAssistant.thinking, null);

	// A planner step that only recorded reasoning is still kept.
	assert.equal(thinkingOnly.content, "");
	assert.equal(thinkingOnly.thinking, "Only a thought was recorded for this step.");
	assert.equal(thinkingOnly.hasToolUse, false);

	assert.equal(parsed.firstMessageAt, "2026-07-17T09:00:00.000Z");
	assert.equal(parsed.lastMessageAt, "2026-07-17T09:00:06.000Z");
});

test("parse degrades to no metadata when the summary DB is missing or corrupt", async () => {
	const dir = useDataDir();
	writeTranscript({
		dataDir: dir,
		lines: [
			stepLine({
				step_index: 0,
				source: "USER_EXPLICIT",
				type: "USER_INPUT",
				status: "DONE",
				created_at: "2026-07-17T09:00:00Z",
				content: "<USER_REQUEST>\nA prompt\n</USER_REQUEST>",
			}),
		],
	});

	const meta = (await antigravityAdapter.scan())[0];
	assert.ok(meta);
	const withoutDb = await antigravityAdapter.parse(meta);
	assert.equal(withoutDb.slug, null);
	assert.equal(withoutDb.cwd, null);
	assert.equal(withoutDb.projectDir, "");
	assert.equal(withoutDb.projectName, "");
	assert.equal(withoutDb.messages.length, 1);

	// A garbage DB file must not fail the parse either.
	writeFileSync(join(dir, "conversation_summaries.db"), "not a sqlite database");
	const withCorruptDb = await antigravityAdapter.parse(meta);
	assert.equal(withCorruptDb.slug, null);
	assert.equal(withCorruptDb.messages.length, 1);
});

test("parse extracts the request when the USER_REQUEST wrapper is absent", async () => {
	const dir = useDataDir();
	writeTranscript({
		dataDir: dir,
		lines: [
			stepLine({
				step_index: 0,
				source: "USER_EXPLICIT",
				type: "USER_INPUT",
				status: "DONE",
				created_at: "2026-07-17T09:00:00Z",
				content: "<CONTEXT>ide state</CONTEXT> A bare prompt",
			}),
		],
	});

	const meta = (await antigravityAdapter.scan())[0];
	assert.ok(meta);
	const parsed = await antigravityAdapter.parse(meta);
	assert.equal(parsed.messages[0]?.content, "ide state A bare prompt");
});

test("scans a WSL distro root and reads its own summary DB", async () => {
	const dir = useDataDir();
	const wslHome = mkdtempSync(join(baseDir, "wsl-home-"));
	const wslRoot = join(wslHome, ".gemini", "antigravity");
	const wslCliRoot = join(wslHome, ".gemini", "antigravity-cli");
	const wslConversationId = "9a3c4d5e-6f70-4812-9bcd-ef0123456789";
	const wslCliConversationId = "b1c2d3e4-5f60-4712-8abc-def012345678";

	await writeSummariesDb({
		dataDir: dir,
		rows: [
			{
				conversationId: CONVERSATION_ID,
				title: "Local login bug",
				workspaceUris: ["file:///c%3A/Users/me/local-repo"],
			},
		],
	});
	writeTranscript({
		dataDir: dir,
		lines: [
			stepLine({
				step_index: 0,
				source: "USER_EXPLICIT",
				type: "USER_INPUT",
				created_at: "2026-08-01T09:00:00Z",
				content: "<USER_REQUEST>\nlocal prompt\n</USER_REQUEST>",
			}),
		],
	});

	mkdirSync(wslRoot, { recursive: true });
	await writeSummariesDb({
		dataDir: wslRoot,
		rows: [
			{
				conversationId: wslConversationId,
				title: "WSL deploy fix",
				workspaceUris: ["file:///home/me/wsl-repo"],
			},
		],
	});
	const wslFilePath = writeTranscript({
		dataDir: wslRoot,
		conversationId: wslConversationId,
		lines: [
			stepLine({
				step_index: 0,
				source: "USER_EXPLICIT",
				type: "USER_INPUT",
				created_at: "2026-08-01T10:00:00Z",
				content: "<USER_REQUEST>\nwsl prompt\n</USER_REQUEST>",
			}),
			stepLine({
				step_index: 1,
				source: "MODEL",
				type: "PLANNER_RESPONSE",
				created_at: "2026-08-01T10:00:01Z",
				content: "wsl reply",
			}),
		],
	});

	// The CLI build of Antigravity keeps the identical layout under
	// `.gemini/antigravity-cli`; both WSL layouts are scanned.
	mkdirSync(wslCliRoot, { recursive: true });
	await writeSummariesDb({
		dataDir: wslCliRoot,
		rows: [
			{
				conversationId: wslCliConversationId,
				title: "WSL CLI session",
				workspaceUris: ["file:///home/me/wsl-cli-repo"],
			},
		],
	});
	const wslCliFilePath = writeTranscript({
		dataDir: wslCliRoot,
		conversationId: wslCliConversationId,
		lines: [
			stepLine({
				step_index: 0,
				source: "USER_EXPLICIT",
				type: "USER_INPUT",
				created_at: "2026-08-02T10:00:00Z",
				content: "<USER_REQUEST>\nwsl cli prompt\n</USER_REQUEST>",
			}),
		],
	});

	setWslHomesForTesting([wslHome]);
	try {
		const info = await antigravityAdapter.detect();
		assert.ok(info);
		// The reported data dir stays the primary Windows root.
		assert.equal(info.dataDir, dir);
		assert.equal(info.conversationCount, 3);

		const metas = await antigravityAdapter.scan();
		assert.equal(metas.length, 3);

		const wsl = metas.find((meta) => meta.id === wslConversationId);
		assert.ok(wsl);
		assert.equal(wsl.rootDir, wslRoot);
		assert.equal(wsl.filePath, wslFilePath);

		const wslCli = metas.find((meta) => meta.id === wslCliConversationId);
		assert.ok(wslCli);
		assert.equal(wslCli.rootDir, wslCliRoot);
		assert.equal(wslCli.filePath, wslCliFilePath);

		const parsed = await antigravityAdapter.parse(wsl);
		// The title/workspace come from the WSL root's summary DB, not the local
		// one.
		assert.equal(parsed.slug, "WSL deploy fix");
		assert.equal(parsed.cwd, "/home/me/wsl-repo");
		assert.equal(parsed.projectName, "wsl-repo");
		assert.deepEqual(
			parsed.messages.map((message) => [message.type, message.content]),
			[
				["user", "wsl prompt"],
				["assistant", "wsl reply"],
			],
		);

		const local = metas.find((meta) => meta.id === CONVERSATION_ID);
		assert.ok(local);
		assert.equal(local.rootDir, dir);
		const localParsed = await antigravityAdapter.parse(local);
		assert.equal(localParsed.slug, "Local login bug");
		assert.equal(localParsed.cwd, "C:/Users/me/local-repo");

		const cliParsed = await antigravityAdapter.parse(wslCli);
		assert.equal(cliParsed.slug, "WSL CLI session");
		assert.equal(cliParsed.cwd, "/home/me/wsl-cli-repo");
		assert.deepEqual(
			cliParsed.messages.map((message) => message.content),
			["wsl cli prompt"],
		);
	} finally {
		setWslHomesForTesting(null);
	}
});

test("watchPaths targets the brain transcript tree", () => {
	const dir = useDataDir();
	assert.deepEqual(antigravityAdapter.watchPaths?.(), [
		resolve(dir, "brain/**/*.jsonl"),
	]);
});
