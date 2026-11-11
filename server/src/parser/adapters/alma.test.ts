import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import initSqlJs, { type Database } from "sql.js";
import { locateSqlJsFile } from "../../test-utils/sql.test-helper.js";

// A real WSL distro is running on this machine: disable live discovery so only
// the injected test homes are scanned (see setWslHomesForTesting below).
process.env.CHATCRYSTAL_WSL = "0";

// appConfig resolves its data dirs when config.ts is first imported, so the
// fixture base has to be in the environment before importing the adapter.
// Each test points appConfig at its own temporary Alma data folder.
const baseDir = mkdtempSync(join(tmpdir(), "chatcrystal-alma-"));
process.env.ALMA_DATA_DIR = baseDir;

const { appConfig } = await import("../../config.js");
const { almaAdapter } = await import("./alma.js");
const { setWslHomesForTesting } = await import("../wsl.js");

after(() => {
	setWslHomesForTesting(null);
	rmSync(baseDir, { recursive: true, force: true });
});

function useDataDir(): string {
	const dir = mkdtempSync(join(baseDir, "data-"));
	appConfig.almaDataDir = dir;
	return dir;
}

/** Write Alma's `chat_threads.db` from a throwaway sql.js database. */
async function writeAlmaDb(
	root: string,
	setup: (db: Database) => void,
): Promise<string> {
	const SQL = await initSqlJs({ locateFile: locateSqlJsFile });
	const db = new SQL.Database();
	try {
		setup(db);
		const dbPath = join(root, "chat_threads.db");
		mkdirSync(dirname(dbPath), { recursive: true });
		writeFileSync(dbPath, Buffer.from(db.export()));
		return dbPath;
	} finally {
		db.close();
	}
}

/** Alma's tables as far as the adapter reads them. */
const ALMA_SCHEMA = `
	CREATE TABLE workspaces (id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL);
	CREATE TABLE chat_threads (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		model TEXT,
		metadata TEXT DEFAULT '{}',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		is_incognito INTEGER DEFAULT 0,
		workspace_id TEXT,
		parent_thread_id TEXT
	);
	CREATE TABLE chat_messages (
		id TEXT,
		thread_id TEXT NOT NULL,
		parent_id TEXT,
		slot_id TEXT,
		depth TEXT NOT NULL,
		message TEXT NOT NULL,
		timestamp TEXT NOT NULL,
		metadata TEXT DEFAULT '{}',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		parent_tool_call_id TEXT
	);
`;

function uiMessage(
	id: string,
	role: "user" | "assistant",
	parts: unknown[],
): string {
	return JSON.stringify({ id, role, parts });
}

function insertMessage(
	db: Database,
	options: {
		id: string;
		threadId: string;
		message: string;
		timestamp: string;
		metadata?: string;
		parentToolCallId?: string;
	},
): void {
	db.run(
		`INSERT INTO chat_messages (id, thread_id, slot_id, depth, message, timestamp, metadata, created_at, updated_at, parent_tool_call_id)
		 VALUES (?, ?, ?, '0.0', ?, ?, ?, ?, ?, ?)`,
		[
			options.id,
			options.threadId,
			options.id,
			options.message,
			options.timestamp,
			options.metadata ?? "{}",
			options.timestamp,
			options.timestamp,
			options.parentToolCallId ?? null,
		],
	);
}

function findMeta(
	metas: Awaited<ReturnType<typeof almaAdapter.scan>>,
	id: string,
) {
	const meta = metas.find((item) => item.id === id);
	assert.ok(meta, `expected scanned chat ${id}`);
	return meta;
}

test("detect returns null and scan is empty when no database exists", async () => {
	useDataDir();
	assert.equal(await almaAdapter.detect(), null);
	assert.deepEqual(await almaAdapter.scan(), []);
	assert.deepEqual(almaAdapter.watchPaths?.(), []);

	// A database without Alma's tables is not a source either.
	const dir = useDataDir();
	await writeAlmaDb(dir, (db) => {
		db.exec("CREATE TABLE unrelated (id TEXT)");
	});
	assert.equal(await almaAdapter.detect(), null);
});

test("detect, scan and parse the chats Alma keeps", async () => {
	const dir = useDataDir();
	const dbPath = await writeAlmaDb(dir, (db) => {
		db.exec(ALMA_SCHEMA);
		db.run(
			"INSERT INTO workspaces (id, path, name) VALUES ('ws1', '/work/alma', 'alma')",
		);
		db.run(
			`INSERT INTO chat_threads (id, title, created_at, updated_at, workspace_id) VALUES
			 ('thA', 'Fix the build', '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:30.000Z', 'ws1'),
			 ('thB', 'New Chat', '2026-10-01T11:00:00.000Z', '2026-10-01T11:00:00.000Z', NULL),
			 ('thC', 'New Chat', '2026-10-01T12:00:00.000Z', '2026-10-01T12:00:00.000Z', NULL)`,
		);
		db.run(
			`INSERT INTO chat_threads (id, title, created_at, updated_at, is_incognito) VALUES
			 ('thD', 'Secret', '2026-10-01T13:00:00.000Z', '2026-10-01T13:00:00.000Z', 1)`,
		);
		// Chats Alma's scheduled tasks run in, told by metadata or by title.
		db.run(
			`INSERT INTO chat_threads (id, title, created_at, updated_at, metadata) VALUES
			 ('thE', 'Daily digest', '2026-10-01T14:00:00.000Z', '2026-10-01T14:00:00.000Z', '{"isCron":true}'),
			 ('thF', '⏰ Cron: daily digest (Retry 1)', '2026-10-01T15:00:00.000Z', '2026-10-01T15:00:00.000Z', '{}')`,
		);

		insertMessage(db, {
			id: "thA--user-1",
			threadId: "thA",
			timestamp: "2026-10-01T10:00:00.000Z",
			message: uiMessage("u1", "user", [
				{ type: "text", text: "Please fix the build" },
				{ type: "file", url: "x", mediaType: "image/png" },
			]),
		});
		insertMessage(db, {
			id: "thA--a1",
			threadId: "thA",
			timestamp: "2026-10-01T10:00:05.000Z",
			metadata: '{"usage":{"inputTokens":1000}}',
			message: uiMessage("a1", "assistant", [
				{ type: "step-start" },
				{ type: "reasoning", text: "hm" },
				{
					type: "tool-Bash",
					toolCallId: "c1",
					state: "output-available",
					input: { command: "make" },
					output: "ok",
				},
				{ type: "dynamic-tool", toolName: "mcp_search", toolCallId: "c4" },
				{ type: "text", text: "Fixed." },
			]),
		});
		// A subagent's reply is nested tool work, not the main conversation.
		insertMessage(db, {
			id: "thA--sub1",
			threadId: "thA",
			timestamp: "2026-10-01T10:00:03.000Z",
			metadata: '{"subagentTaskId":"t1"}',
			parentToolCallId: "c3",
			message: uiMessage("s1", "assistant", [
				{ type: "tool-Read", toolCallId: "r1", input: { path: "Makefile" } },
			]),
		});
		// The note a compaction leaves, not something said.
		insertMessage(db, {
			id: "thA--compact",
			threadId: "thA",
			timestamp: "2026-10-01T10:00:20.000Z",
			metadata: '{"isCompactionIndicator":true}',
			message: uiMessage("k1", "assistant", [
				{ type: "text", text: "Summary of the chat so far" },
			]),
		});

		insertMessage(db, {
			id: "thB--user-1",
			threadId: "thB",
			timestamp: "2026-10-01T11:00:01.000Z",
			message: uiMessage("u2", "user", [
				{ type: "text", text: "What   is\nWAL?" },
			]),
		});

		// Hidden chats have messages too; they must not be imported.
		for (const threadId of ["thD", "thE", "thF"]) {
			insertMessage(db, {
				id: `${threadId}--user-1`,
				threadId,
				timestamp: "2026-10-01T16:00:01.000Z",
				message: uiMessage(`${threadId}u`, "user", [
					{ type: "text", text: "hidden prompt" },
				]),
			});
		}
	});

	const info = await almaAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "alma");
	assert.equal(info.displayName, "Alma");
	assert.equal(info.dataDir, dir);
	assert.equal(info.conversationCount, 2);

	const metas = await almaAdapter.scan();
	assert.equal(metas.length, 2);
	const meta = findMeta(metas, "thA");
	assert.equal(meta.source, "alma");
	assert.equal(meta.filePath, dbPath);
	assert.equal(meta.rootDir, dir);
	assert.equal(meta.projectDir, "/work/alma");
	assert.equal(meta.fileSize, 0);
	assert.equal(meta.fileMtime, "2026-10-01T10:00:30.000Z");

	const parsed = await almaAdapter.parse(meta);
	assert.equal(parsed.id, meta.id);
	assert.equal(parsed.source, "alma");
	assert.equal(parsed.slug, "Fix the build");
	assert.equal(parsed.projectDir, "/work/alma");
	assert.equal(parsed.projectName, "alma");
	assert.equal(parsed.cwd, "/work/alma");
	assert.equal(parsed.gitBranch, null);

	assert.deepEqual(
		parsed.messages.map((message) => [
			message.id,
			message.type,
			message.content,
		]),
		[
			["u1", "user", "Please fix the build"],
			["a1", "assistant", "Fixed."],
		],
	);
	const assistant = parsed.messages[1];
	assert.equal(assistant?.thinking, "hm");
	assert.equal(assistant?.hasToolUse, true);
	assert.equal(assistant?.hasCode, false);
	assert.equal(assistant?.timestamp, "2026-10-01T10:00:05.000Z");
	assert.equal(parsed.firstMessageAt, "2026-10-01T10:00:00.000Z");
	assert.equal(parsed.lastMessageAt, "2026-10-01T10:00:05.000Z");

	// An unnamed chat has no slug yet.
	const unnamed = await almaAdapter.parse(findMeta(metas, "thB"));
	assert.equal(unnamed.id, "thB");
	assert.equal(unnamed.slug, null);
	assert.equal(unnamed.projectDir, "");
	assert.equal(unnamed.cwd, null);
	assert.deepEqual(
		unnamed.messages.map((message) => message.content),
		["What   is\nWAL?"],
	);

	// Only the local database is watched.
	assert.deepEqual(almaAdapter.watchPaths?.(), [dbPath]);
});

test("older schemas without workspaces or message metadata still parse", async () => {
	const dir = useDataDir();
	await writeAlmaDb(dir, (db) => {
		db.exec(`
			CREATE TABLE chat_threads (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
			CREATE TABLE chat_messages (id TEXT, thread_id TEXT NOT NULL, message TEXT NOT NULL, timestamp TEXT NOT NULL);
		`);
		db.run(
			"INSERT INTO chat_threads (id, title, created_at, updated_at) VALUES ('old', 'Older chat', '2026-10-02T09:00:00.000Z', '2026-10-02T09:10:00.000Z')",
		);
		db.run(
			"INSERT INTO chat_messages (id, thread_id, message, timestamp) VALUES ('old-1', 'old', ?, '2026-10-02T09:00:01.000Z')",
			[uiMessage("o1", "user", [{ type: "text", text: "old prompt" }])],
		);
		db.run(
			"INSERT INTO chat_messages (id, thread_id, message, timestamp) VALUES ('old-2', 'old', ?, '2026-10-02T09:00:02.000Z')",
			[uiMessage("o2", "assistant", [{ type: "text", text: "old reply" }])],
		);
	});

	const info = await almaAdapter.detect();
	assert.ok(info);
	assert.equal(info.conversationCount, 1);

	const metas = await almaAdapter.scan();
	assert.equal(metas.length, 1);
	const parsed = await almaAdapter.parse(findMeta(metas, "old"));
	assert.equal(parsed.slug, "Older chat");
	assert.equal(parsed.projectDir, "");
	assert.deepEqual(
		parsed.messages.map((message) => message.content),
		["old prompt", "old reply"],
	);
});

test("desktop-only: WSL distro homes are not scanned", async () => {
	const localDir = useDataDir();
	const wslHome = mkdtempSync(join(baseDir, "wsl-home-"));
	const wslRoot = join(wslHome, ".config", "alma");

	await writeAlmaDb(localDir, (db) => {
		db.exec(`
			CREATE TABLE chat_threads (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
			CREATE TABLE chat_messages (id TEXT, thread_id TEXT NOT NULL, message TEXT NOT NULL, timestamp TEXT NOT NULL);
		`);
		db.run(
			"INSERT INTO chat_threads (id, title, created_at, updated_at) VALUES ('local', 'Local chat', '2026-10-03T09:00:00.000Z', '2026-10-03T09:10:00.000Z')",
		);
		db.run(
			"INSERT INTO chat_messages (id, thread_id, message, timestamp) VALUES ('l1', 'local', ?, '2026-10-03T09:00:01.000Z')",
			[uiMessage("l1", "user", [{ type: "text", text: "local prompt" }])],
		);
	});
	await writeAlmaDb(wslRoot, (db) => {
		db.exec(`
			CREATE TABLE chat_threads (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
			CREATE TABLE chat_messages (id TEXT, thread_id TEXT NOT NULL, message TEXT NOT NULL, timestamp TEXT NOT NULL);
		`);
		db.run(
			"INSERT INTO chat_threads (id, title, created_at, updated_at) VALUES ('wsl', 'WSL chat', '2026-10-03T10:00:00.000Z', '2026-10-03T10:10:00.000Z')",
		);
		db.run(
			"INSERT INTO chat_messages (id, thread_id, message, timestamp) VALUES ('w1', 'wsl', ?, '2026-10-03T10:00:01.000Z')",
			[uiMessage("w1", "user", [{ type: "text", text: "wsl prompt" }])],
		);
	});

	setWslHomesForTesting([wslHome]);
	try {
		const info = await almaAdapter.detect();
		assert.ok(info);
		assert.equal(info.dataDir, localDir);
		assert.equal(info.conversationCount, 1);

		const metas = await almaAdapter.scan();
		assert.deepEqual(
			metas.map((meta) => [meta.id, meta.rootDir]),
			[["local", localDir]],
		);
	} finally {
		setWslHomesForTesting(null);
	}
});
