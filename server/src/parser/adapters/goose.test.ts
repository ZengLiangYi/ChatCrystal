import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import initSqlJs, { type Database } from "sql.js";
import { locateSqlJsFile } from "../../test-utils/sql.test-helper.js";

// A real WSL distro is running on this machine: disable live discovery so only
// the injected test homes are scanned (see setWslHomesForTesting below).
process.env.CHATCRYSTAL_WSL = "0";

// appConfig is frozen as soon as config.ts is first imported, so point the
// adapter's env var at a fresh fixture root *before* importing the adapter.
const dataDir = mkdtempSync(join(tmpdir(), "cc-goose-"));
process.env.GOOSE_DATA_DIR = dataDir;

const { appConfig } = await import("../../config.js");
const { gooseAdapter } = await import("./goose.js");
const { setWslHomesForTesting } = await import("../wsl.js");

const sessionsDir = resolve(dataDir, "sessions");

after(() => {
	rmSync(dataDir, { recursive: true, force: true });
});

function writeLegacyJsonl(
	fileName: string,
	lines: Array<Record<string, unknown> | string>,
	root = dataDir,
): string {
	const sessions = resolve(root, "sessions");
	mkdirSync(sessions, { recursive: true });
	const filePath = resolve(sessions, fileName);
	const body = `${lines
		.map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
		.join("\n")}\n`;
	writeFileSync(filePath, body, "utf-8");
	return filePath;
}

async function createSqliteDatabase(): Promise<Database> {
	const SQL = await initSqlJs({ locateFile: locateSqlJsFile });
	return new SQL.Database();
}

function writeSqliteDatabase(
	db: Database,
	root = dataDir,
	fileName = "sessions.db",
): string {
	const sessions = resolve(root, "sessions");
	mkdirSync(sessions, { recursive: true });
	const filePath = resolve(sessions, fileName);
	writeFileSync(filePath, db.export());
	db.close();
	return filePath;
}

function conversationMeta(
	filePath: string,
	id: string,
	projectDir = "",
): {
	id: string;
	source: string;
	filePath: string;
	fileSize: number;
	fileMtime: string;
	projectDir: string;
} {
	return {
		id,
		source: "goose",
		filePath,
		fileSize: statSync(filePath).size,
		fileMtime: "2026-05-05T00:00:00.000Z",
		projectDir,
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

test("detect, scan and parse the legacy JSONL store", async () => {
	assert.equal(await gooseAdapter.detect(), null);
	assert.deepEqual(gooseAdapter.watchPaths?.(), []);

	const createdSeconds = 1767261600;
	const filePath = writeLegacyJsonl("legacy-session.jsonl", [
		{
			id: "goose-legacy-1",
			description: "Legacy deploy",
			working_dir: "/work/goose-legacy",
			created_at: "2026-01-01T09:00:00.000Z",
			updated_at: "2026-01-01T09:30:00.000Z",
		},
		{
			role: "user",
			created: createdSeconds,
			content: [{ type: "text", text: "Hello goose" }],
		},
		{
			role: "assistant",
			created: "2026-01-01T10:05:00.000Z",
			content: [
				{ type: "thinking", thinking: "pondering" },
				{ type: "text", text: "Hi there" },
				{ type: "toolRequest", tool_call: { name: "shell" } },
			],
		},
		// Tool responses and system prompts are not conversation text.
		{
			role: "user",
			created: "2026-01-01T10:06:00.000Z",
			content: [{ type: "toolResponse", tool_result: {} }],
		},
		{
			role: "system",
			created: "2026-01-01T10:06:30.000Z",
			content: [{ type: "text", text: "system prompt" }],
		},
		"{not valid json",
		{
			role: "assistant",
			created: createdSeconds + 60,
			content: [{ type: "text", text: "Run:\n```sh\nls\n```" }],
		},
	]);

	const info = await gooseAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "goose");
	assert.equal(info.displayName, "Goose");
	assert.equal(info.dataDir, dataDir);
	assert.equal(info.conversationCount, 1);

	const metas = await gooseAdapter.scan();
	assert.equal(metas.length, 1);
	assert.equal(metas[0]?.id, "goose-legacy-1");
	assert.equal(metas[0]?.source, "goose");
	assert.equal(metas[0]?.filePath, filePath);
	assert.equal(metas[0]?.projectDir, "/work/goose-legacy");
	assert.equal(metas[0]?.fileSize, statSync(filePath).size);
	assert.equal(metas[0]?.fileMtime, statSync(filePath).mtime.toISOString());

	const parsed = await gooseAdapter.parse(metas[0]);
	assert.equal(parsed.id, "goose-legacy-1");
	assert.equal(parsed.source, "goose");
	assert.equal(parsed.slug, "Legacy deploy");
	assert.equal(parsed.projectDir, "/work/goose-legacy");
	assert.equal(parsed.projectName, "goose-legacy");
	assert.equal(parsed.cwd, "/work/goose-legacy");
	assert.equal(parsed.gitBranch, null);

	assert.equal(parsed.messages.length, 3);
	assert.deepEqual(
		parsed.messages.map((message) => [message.type, message.role]),
		[
			["user", "user"],
			["assistant", "assistant"],
			["assistant", "assistant"],
		],
	);

	const [user, assistant, codeAssistant] = parsed.messages;
	assert.equal(user?.id, "goose-legacy-1-0");
	assert.equal(user?.content, "Hello goose");
	assert.equal(user?.timestamp, new Date(createdSeconds * 1000).toISOString());
	assert.equal(user?.hasToolUse, false);

	assert.equal(assistant?.content, "Hi there");
	assert.equal(assistant?.thinking, "pondering");
	assert.equal(assistant?.hasToolUse, true);
	assert.equal(assistant?.timestamp, "2026-01-01T10:05:00.000Z");

	assert.equal(codeAssistant?.hasCode, true);

	assert.equal(
		parsed.firstMessageAt,
		new Date(createdSeconds * 1000).toISOString(),
	);
	assert.equal(parsed.lastMessageAt, new Date((createdSeconds + 60) * 1000).toISOString());

	// Only the legacy glob exists so far.
	assert.deepEqual(gooseAdapter.watchPaths?.(), [
		resolve(sessionsDir, "*.jsonl"),
	]);
});

test("scan prefers the SQLite store and skips duplicate legacy files", async () => {
	const db = await createSqliteDatabase();
	db.exec(`
		CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT '',
			description TEXT NOT NULL DEFAULT '',
			working_dir TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			message_id TEXT,
			session_id TEXT NOT NULL,
			role TEXT NOT NULL,
			content_json TEXT NOT NULL,
			created_timestamp INTEGER NOT NULL,
			timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);
	`);
	db.run(
		"INSERT INTO sessions (id, name, description, working_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
		[
			"s-db-1",
			"DB Session",
			"SQLite session",
			"/work/goose-db",
			"2026-02-01 10:00:00",
			"2026-02-01 10:05:00",
		],
	);
	db.run(
		"INSERT INTO sessions (id, name, description, working_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
		[
			"goose-legacy-1",
			"",
			"Database wins",
			"/work/db-wins",
			"2026-02-02 00:00:00",
			"2026-02-02 00:10:00",
		],
	);
	const insertMessage = (
		messageId: string | null,
		sessionId: string,
		role: string,
		content: unknown,
		createdTimestamp: number,
	) => {
		db.run(
			"INSERT INTO messages (message_id, session_id, role, content_json, created_timestamp) VALUES (?, ?, ?, ?, ?)",
			[
				messageId,
				sessionId,
				role,
				typeof content === "string" ? content : JSON.stringify(content),
				createdTimestamp,
			],
		);
	};
	insertMessage("m-1", "s-db-1", "user", [{ type: "text", text: "DB hello" }], 1767262000000);
	insertMessage(
		"m-2",
		"s-db-1",
		"assistant",
		[
			{ type: "text", text: "DB hi" },
			{ type: "thinking", thinking: "db think" },
		],
		1767262001000,
	);
	insertMessage("m-3", "s-db-1", "tool", [{ type: "text", text: "tool output" }], 1767262002000);
	insertMessage("m-4", "s-db-1", "system", [{ type: "text", text: "system" }], 1767262003000);
	insertMessage(
		"m-5",
		"goose-legacy-1",
		"user",
		[{ type: "text", text: "DB legacy body" }],
		1767263000000,
	);
	insertMessage(
		"m-6",
		"goose-legacy-1",
		"assistant",
		[{ type: "text", text: "DB legacy reply" }],
		1767263001000,
	);
	const dbPath = writeSqliteDatabase(db);

	const info = await gooseAdapter.detect();
	assert.ok(info);
	// The duplicate legacy id is only one conversation.
	assert.equal(info.conversationCount, 2);

	const metas = await gooseAdapter.scan();
	assert.equal(metas.length, 2);
	assert.deepEqual(
		metas.map((meta) => meta.id).sort(),
		["goose-legacy-1", "s-db-1"],
	);

	const dbMeta = metas.find((meta) => meta.id === "s-db-1");
	assert.ok(dbMeta);
	assert.equal(dbMeta.source, "goose");
	assert.equal(dbMeta.filePath, dbPath);
	// The shared database file cannot identify a single session, so the dedup
	// signal is the per-session updated_at with a constant size.
	assert.equal(dbMeta.fileSize, 0);
	assert.equal(dbMeta.fileMtime, "2026-02-01T10:05:00.000Z");
	assert.equal(dbMeta.projectDir, "/work/goose-db");

	const parsed = await gooseAdapter.parse(dbMeta);
	assert.equal(parsed.id, "s-db-1");
	assert.equal(parsed.slug, "SQLite session");
	assert.equal(parsed.projectDir, "/work/goose-db");
	assert.equal(parsed.projectName, "goose-db");
	assert.equal(parsed.messages.length, 2);

	const [user, assistant] = parsed.messages;
	assert.equal(user?.content, "DB hello");
	assert.equal(user?.id, "m-1");
	assert.equal(user?.timestamp, new Date(1767262000000).toISOString());
	assert.equal(assistant?.id, "m-2");
	assert.equal(assistant?.content, "DB hi");
	assert.equal(assistant?.thinking, "db think");
	assert.equal(assistant?.timestamp, new Date(1767262001000).toISOString());

	// The legacy JSONL has the same id as a database row: the database wins.
	const duplicateMeta = metas.find((meta) => meta.id === "goose-legacy-1");
	assert.ok(duplicateMeta);
	assert.equal(duplicateMeta.filePath, dbPath);
	const duplicate = await gooseAdapter.parse(duplicateMeta);
	assert.equal(duplicate.slug, "Database wins");
	assert.equal(duplicate.projectDir, "/work/db-wins");
	assert.deepEqual(
		duplicate.messages.map((message) => message.content),
		["DB legacy body", "DB legacy reply"],
	);

	// Both store generations are watched once the database exists.
	assert.deepEqual(gooseAdapter.watchPaths?.(), [
		dbPath,
		resolve(sessionsDir, "*.jsonl"),
	]);
});

test("SQLite schema probing tolerates drifted column names", async () => {
	// Give the previous database file a different mtime so the adapter's
	// per-path handle cache is refreshed.
	await sleep(25);

	const db = await createSqliteDatabase();
	// No description/name columns (title instead), no message_id/id columns,
	// and an unambiguous created_timestamp.
	db.exec(`
		CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			title TEXT,
			working_dir TEXT,
			created_at TEXT,
			updated_at TEXT
		);
		CREATE TABLE messages (
			session_id TEXT NOT NULL,
			role TEXT NOT NULL,
			content_json TEXT NOT NULL,
			created_timestamp INTEGER NOT NULL
		);
	`);
	db.run(
		"INSERT INTO sessions (id, title, working_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
		[
			"alt-1",
			"Title only",
			"C:\\work\\alt",
			"2026-03-01 00:00:00",
			"2026-03-01 01:00:00",
		],
	);
	const insertMessage = (
		role: string,
		content: string,
		createdTimestamp: number,
	) => {
		db.run(
			"INSERT INTO messages (session_id, role, content_json, created_timestamp) VALUES (?, ?, ?, ?)",
			["alt-1", role, content, createdTimestamp],
		);
	};
	insertMessage("user", JSON.stringify([{ type: "text", text: "Alt hello" }]), 1767264000000);
	insertMessage("assistant", JSON.stringify([{ type: "text", text: "Alt hi" }]), 1767264001000);
	const dbPath = writeSqliteDatabase(db);

	const metas = await gooseAdapter.scan();
	assert.deepEqual(
		metas.map((meta) => meta.id).sort(),
		["alt-1", "goose-legacy-1"],
	);
	const meta = metas.find((candidate) => candidate.id === "alt-1");
	assert.ok(meta);
	assert.equal(meta.filePath, dbPath);
	assert.equal(meta.projectDir, "C:\\work\\alt");
	assert.equal(meta.fileMtime, "2026-03-01T01:00:00.000Z");

	const parsed = await gooseAdapter.parse(meta);
	assert.equal(parsed.slug, "Title only");
	assert.equal(parsed.projectDir, "C:\\work\\alt");
	assert.equal(parsed.projectName, "alt");
	assert.deepEqual(
		parsed.messages.map((message) => message.content),
		["Alt hello", "Alt hi"],
	);
	assert.deepEqual(
		parsed.messages.map((message) => message.id),
		["alt-1-0", "alt-1-1"],
	);
});

test("legacy JSONL without a metadata header still parses", async () => {
	writeLegacyJsonl("raw.jsonl", [
		{
			role: "user",
			created: 1767261600,
			content: [{ type: "text", text: "Raw one" }],
		},
		{
			role: "assistant",
			created: "2026-04-01T00:00:00.000Z",
			content: [{ type: "text", text: "Raw two" }],
		},
	]);

	const metas = await gooseAdapter.scan();
	const meta = metas.find((candidate) => candidate.id === "raw");
	assert.ok(meta);
	assert.equal(meta.projectDir, "");

	const parsed = await gooseAdapter.parse(meta);
	assert.equal(parsed.id, "raw");
	assert.equal(parsed.slug, null);
	assert.equal(parsed.projectDir, "");
	assert.equal(parsed.cwd, null);
	assert.deepEqual(
		parsed.messages.map((message) => [message.type, message.content]),
		[
			["user", "Raw one"],
			["assistant", "Raw two"],
		],
	);
	assert.equal(
		parsed.messages[0]?.timestamp,
		new Date(1767261600 * 1000).toISOString(),
	);
	assert.equal(parsed.messages[1]?.timestamp, "2026-04-01T00:00:00.000Z");
});

test("parse reports empty conversations without throwing", async () => {
	const emptyPath = writeLegacyJsonl("empty.jsonl", []);
	const parsed = await gooseAdapter.parse(
		conversationMeta(emptyPath, "empty", "/work/empty"),
	);
	assert.equal(parsed.id, "empty");
	assert.equal(parsed.messages.length, 0);
	assert.equal(parsed.slug, null);
	assert.equal(parsed.projectDir, "/work/empty");
	assert.equal(parsed.firstMessageAt, "2026-05-05T00:00:00.000Z");
});

test("scans a WSL distro root with its own SQLite and legacy stores", async () => {
	const localRoot = mkdtempSync(join(tmpdir(), "cc-goose-local-"));
	const wslHome = mkdtempSync(join(tmpdir(), "cc-goose-wsl-"));
	const wslRoot = join(wslHome, ".local", "share", "goose");
	appConfig.gooseDataDir = localRoot;

	const localPath = writeLegacyJsonl(
		"local-legacy.jsonl",
		[
			{
				id: "goose-local",
				description: "Local session",
				working_dir: "C:\\work\\local-goose",
				created_at: "2026-06-01T09:00:00.000Z",
				updated_at: "2026-06-01T09:10:00.000Z",
			},
			{
				role: "user",
				created: 1768000000,
				content: [{ type: "text", text: "local prompt" }],
			},
		],
		localRoot,
	);

	const db = await createSqliteDatabase();
	db.exec(`
		CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT '',
			description TEXT NOT NULL DEFAULT '',
			working_dir TEXT NOT NULL,
			created_at TIMESTAMP,
			updated_at TIMESTAMP
		);
		CREATE TABLE messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			message_id TEXT,
			session_id TEXT NOT NULL,
			role TEXT NOT NULL,
			content_json TEXT NOT NULL,
			created_timestamp INTEGER NOT NULL
		);
	`);
	db.run(
		"INSERT INTO sessions (id, name, description, working_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
		[
			"goose-wsl-db",
			"",
			"WSL DB session",
			"/home/me/wsl-goose",
			"2026-06-02 10:00:00",
			"2026-06-02 10:05:00",
		],
	);
	db.run(
		"INSERT INTO messages (message_id, session_id, role, content_json, created_timestamp) VALUES (?, ?, ?, ?, ?)",
		[
			"wsl-m-1",
			"goose-wsl-db",
			"user",
			JSON.stringify([{ type: "text", text: "wsl db hello" }]),
			1768100000000,
		],
	);
	db.run(
		"INSERT INTO messages (message_id, session_id, role, content_json, created_timestamp) VALUES (?, ?, ?, ?, ?)",
		[
			"wsl-m-2",
			"goose-wsl-db",
			"assistant",
			JSON.stringify([{ type: "text", text: "wsl db reply" }]),
			1768100001000,
		],
	);
	const wslDbPath = writeSqliteDatabase(db, wslRoot);

	const wslLegacyPath = writeLegacyJsonl(
		"wsl-legacy.jsonl",
		[
			{
				id: "goose-wsl-legacy",
				description: "WSL legacy session",
				working_dir: "/home/me/wsl-legacy",
				created_at: "2026-06-03T09:00:00.000Z",
				updated_at: "2026-06-03T09:10:00.000Z",
			},
			{
				role: "user",
				created: 1768200000,
				content: [{ type: "text", text: "wsl legacy prompt" }],
			},
		],
		wslRoot,
	);

	setWslHomesForTesting([wslHome]);
	try {
		const info = await gooseAdapter.detect();
		assert.ok(info);
		// The reported data dir stays the primary Windows root.
		assert.equal(info.dataDir, localRoot);
		assert.equal(info.conversationCount, 3);

		const metas = await gooseAdapter.scan();
		assert.equal(metas.length, 3);

		const local = metas.find((meta) => meta.id === "goose-local");
		assert.ok(local);
		assert.equal(local.rootDir, localRoot);
		assert.equal(local.filePath, localPath);

		const wslDb = metas.find((meta) => meta.id === "goose-wsl-db");
		assert.ok(wslDb);
		assert.equal(wslDb.rootDir, wslRoot);
		assert.equal(wslDb.filePath, wslDbPath);
		assert.equal(wslDb.projectDir, "/home/me/wsl-goose");

		const wslLegacy = metas.find((meta) => meta.id === "goose-wsl-legacy");
		assert.ok(wslLegacy);
		assert.equal(wslLegacy.rootDir, wslRoot);
		assert.equal(wslLegacy.filePath, wslLegacyPath);

		const parsedDb = await gooseAdapter.parse(wslDb);
		assert.equal(parsedDb.slug, "WSL DB session");
		assert.deepEqual(
			parsedDb.messages.map((message) => message.content),
			["wsl db hello", "wsl db reply"],
		);

		const parsedLegacy = await gooseAdapter.parse(wslLegacy);
		assert.equal(parsedLegacy.slug, "WSL legacy session");
		assert.deepEqual(
			parsedLegacy.messages.map((message) => message.content),
			["wsl legacy prompt"],
		);
	} finally {
		setWslHomesForTesting(null);
		appConfig.gooseDataDir = dataDir;
		rmSync(localRoot, { recursive: true, force: true });
		rmSync(wslHome, { recursive: true, force: true });
	}
});
