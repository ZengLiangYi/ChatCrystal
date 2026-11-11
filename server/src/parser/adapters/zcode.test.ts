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
// Each test points appConfig at its own temporary ZCode home.
const baseDir = mkdtempSync(join(tmpdir(), "chatcrystal-zcode-"));
process.env.ZCODE_HOME = baseDir;

const { appConfig } = await import("../../config.js");
const { zcodeAdapter } = await import("./zcode.js");
const { setWslHomesForTesting } = await import("../wsl.js");

after(() => {
	setWslHomesForTesting(null);
	rmSync(baseDir, { recursive: true, force: true });
});

function useDataDir(): string {
	const dir = mkdtempSync(join(baseDir, "data-"));
	appConfig.zcodeDataDir = dir;
	return dir;
}

/** Write `<root>/cli/db/db.sqlite` from a throwaway sql.js database. */
async function writeZcodeDb(
	root: string,
	setup: (db: Database) => void,
): Promise<string> {
	const SQL = await initSqlJs({ locateFile: locateSqlJsFile });
	const db = new SQL.Database();
	try {
		setup(db);
		const dbPath = join(root, "cli", "db", "db.sqlite");
		mkdirSync(dirname(dbPath), { recursive: true });
		writeFileSync(dbPath, Buffer.from(db.export()));
		return dbPath;
	} finally {
		db.close();
	}
}

// OpenCode's 1.x tables plus ZCode's `title_source` session column.
const V1_SCHEMA = `
	CREATE TABLE session (
		id TEXT PRIMARY KEY,
		project_id TEXT NOT NULL,
		slug TEXT NOT NULL,
		directory TEXT NOT NULL,
		title TEXT NOT NULL,
		title_source TEXT,
		parent_id TEXT,
		version TEXT NOT NULL,
		time_created INTEGER NOT NULL,
		time_updated INTEGER NOT NULL
	);
	CREATE TABLE message (
		id TEXT PRIMARY KEY,
		session_id TEXT NOT NULL,
		time_created INTEGER NOT NULL,
		time_updated INTEGER NOT NULL,
		data TEXT NOT NULL
	);
	CREATE TABLE part (
		id TEXT PRIMARY KEY,
		message_id TEXT NOT NULL,
		session_id TEXT NOT NULL,
		time_created INTEGER NOT NULL,
		time_updated INTEGER NOT NULL,
		data TEXT NOT NULL
	);
`;

const V2_SCHEMA = `
	CREATE TABLE session_v2 (
		id TEXT PRIMARY KEY,
		project_id TEXT NOT NULL,
		workspace_id TEXT,
		parent_id TEXT,
		slug TEXT NOT NULL,
		directory TEXT NOT NULL,
		path TEXT,
		title TEXT,
		title_source TEXT,
		version TEXT NOT NULL,
		time_created INTEGER NOT NULL,
		time_updated INTEGER NOT NULL
	);
	CREATE TABLE session_message (
		id TEXT PRIMARY KEY,
		session_id TEXT NOT NULL,
		type TEXT NOT NULL,
		seq INTEGER NOT NULL,
		time_created INTEGER NOT NULL,
		time_updated INTEGER NOT NULL,
		data TEXT NOT NULL
	);
`;

function findMeta(
	metas: Awaited<ReturnType<typeof zcodeAdapter.scan>>,
	id: string,
) {
	const meta = metas.find((item) => item.id === id);
	assert.ok(meta, `expected scanned conversation ${id}`);
	return meta;
}

test("detect returns null and scan is empty when no database exists", async () => {
	useDataDir();
	assert.equal(await zcodeAdapter.detect(), null);
	assert.deepEqual(await zcodeAdapter.scan(), []);
});

test("detect returns null for a corrupt database file", async () => {
	const dir = useDataDir();
	const dbPath = join(dir, "cli", "db", "db.sqlite");
	mkdirSync(dirname(dbPath), { recursive: true });
	writeFileSync(dbPath, "this is not a sqlite database");
	assert.equal(await zcodeAdapter.detect(), null);
	assert.deepEqual(await zcodeAdapter.scan(), []);
});

test("parses the OpenCode 1.x store ZCode keeps", async () => {
	const dir = useDataDir();
	const userAt = 1790496001000;
	const assistantAt = 1790496003000;
	const completedAt = 1790496030000;

	const dbPath = await writeZcodeDb(dir, (db) => {
		db.exec(V1_SCHEMA);
		db.run(
			`INSERT INTO session (id, project_id, slug, directory, title, title_source, parent_id, version, time_created, time_updated)
			 VALUES (?, 'p', 's', ?, ?, ?, NULL, '0.16.9', ?, ?)`,
			[
				"ses_zcA",
				"/work/zc",
				"Port the parser to Go",
				"ai",
				userAt,
				completedAt,
			],
		);
		db.run(
			`INSERT INTO session (id, project_id, slug, directory, title, title_source, parent_id, version, time_created, time_updated)
			 VALUES ('ses_zcDefault', 'p', 's', '/work/zc', 'New session - default', 'default', NULL, '0.16.9', ?, ?)`,
			[userAt, userAt],
		);

		const insertMessage = (
			id: string,
			sessionId: string,
			at: number,
			data: Record<string, unknown>,
		): void => {
			db.run(
				`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`,
				[id, sessionId, at, at, JSON.stringify(data)],
			);
		};
		insertMessage("msg_u1", "ses_zcA", userAt, {
			id: "msg_u1",
			role: "user",
			time: { created: userAt },
			semantics: { origin: "real_user" },
		});
		// Harness-injected reminder: not something the person typed.
		insertMessage("msg_u2", "ses_zcA", userAt + 500, {
			id: "msg_u2",
			role: "user",
			time: { created: userAt + 500 },
			semantics: { origin: "system_reminder" },
		});
		insertMessage("msg_u3", "ses_zcA", assistantAt, {
			id: "msg_u3",
			role: "assistant",
			time: { created: assistantAt, completed: completedAt },
			modelId: "glm-5.1",
		});
		// An assistant turn with no content is dropped.
		insertMessage("msg_u4", "ses_zcA", completedAt + 1000, {
			id: "msg_u4",
			role: "assistant",
			time: { created: completedAt + 1000 },
		});

		const insertPart = (
			id: string,
			messageId: string,
			at: number,
			data: Record<string, unknown>,
		): void => {
			db.run(
				`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, 'ses_zcA', ?, ?, ?)`,
				[id, messageId, at, at, JSON.stringify(data)],
			);
		};
		insertPart("prt_u1", "msg_u1", userAt, {
			type: "text",
			text: "Port the parser to Go",
		});
		insertPart("prt_u2", "msg_u2", userAt + 500, {
			type: "text",
			text: "Remember the house rules",
		});
		insertPart("prt_a1", "msg_u3", assistantAt, {
			type: "reasoning",
			text: "Look at the current parser first.",
		});
		insertPart("prt_a2", "msg_u3", assistantAt, {
			type: "tool",
			name: "read",
			state: { input: { filePath: "parser.go" } },
		});
		insertPart("prt_a3", "msg_u3", assistantAt, {
			type: "text",
			text: "Ported the parser to Go.",
		});
	});

	const info = await zcodeAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "zcode");
	assert.equal(info.displayName, "ZCode");
	assert.equal(info.dataDir, dir);
	assert.equal(info.conversationCount, 2);

	const metas = await zcodeAdapter.scan();
	assert.equal(metas.length, 2);
	const meta = findMeta(metas, "ses_zcA");
	assert.equal(meta.source, "zcode");
	assert.equal(meta.filePath, dbPath);
	assert.equal(meta.rootDir, dir);
	assert.equal(meta.projectDir, "/work/zc");
	assert.ok(meta.fileSize > 0);
	assert.ok(!Number.isNaN(Date.parse(meta.fileMtime)));

	const parsed = await zcodeAdapter.parse(meta);
	assert.equal(parsed.id, meta.id);
	assert.equal(parsed.source, "zcode");
	assert.equal(parsed.slug, "Port the parser to Go");
	assert.equal(parsed.projectDir, "/work/zc");
	assert.equal(parsed.projectName, "zc");
	assert.equal(parsed.cwd, "/work/zc");
	assert.equal(parsed.gitBranch, null);

	assert.deepEqual(
		parsed.messages.map((message) => message.id),
		["msg_u1", "msg_u3"],
	);
	assert.deepEqual(
		parsed.messages.map((message) => message.type),
		["user", "assistant"],
	);
	assert.equal(parsed.messages[0]?.content, "Port the parser to Go");
	assert.equal(parsed.messages[1]?.content, "Ported the parser to Go.");
	assert.equal(parsed.messages[1]?.thinking, "Look at the current parser first.");
	assert.equal(parsed.messages[1]?.hasToolUse, true);
	assert.equal(parsed.messages[1]?.hasCode, false);
	// Timestamps are coerced from epoch milliseconds to ISO and sorted.
	assert.equal(parsed.firstMessageAt, new Date(userAt).toISOString());
	assert.equal(parsed.lastMessageAt, new Date(assistantAt).toISOString());

	// ZCode writes a placeholder title until it names the session: no slug.
	const placeholder = await zcodeAdapter.parse(
		findMeta(metas, "ses_zcDefault"),
	);
	assert.equal(placeholder.id, "ses_zcDefault");
	assert.equal(placeholder.slug, null);
	assert.deepEqual(placeholder.messages, []);
});

test("parses the newer session_v2 + session_message store", async () => {
	const dir = useDataDir();
	const createdAt = 1791000000000;
	const userAt = 1791000001000;
	const assistantAt = 1791000005000;

	await writeZcodeDb(dir, (db) => {
		db.exec(V2_SCHEMA);
		db.run(
			`INSERT INTO session_v2 (id, project_id, workspace_id, parent_id, slug, directory, title, title_source, version, time_created, time_updated)
			 VALUES ('ses_v2', 'p', NULL, NULL, 'ses_v2', '/home/me/v2-app', 'Fix the loader', 'generated', '0.16.9', ?, ?)`,
			[createdAt, assistantAt],
		);
		db.run(
			`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
			 VALUES (?, 'ses_v2', 'user', 1, ?, ?, ?)`,
			[
				"msg_v2_u",
				userAt,
				userAt,
				JSON.stringify({
					time: { created: userAt },
					text: "why is the loader slow?",
				}),
			],
		);
		db.run(
			`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
			 VALUES (?, 'ses_v2', 'assistant', 2, ?, ?, ?)`,
			[
				"msg_v2_a",
				assistantAt,
				assistantAt,
				JSON.stringify({
					time: { created: assistantAt },
					content: [
						{ type: "reasoning", text: "It scans every file." },
						{ type: "tool", name: "shell" },
						{ type: "text", text: "It scans every file eagerly." },
					],
				}),
			],
		);
	});

	const metas = await zcodeAdapter.scan();
	assert.equal(metas.length, 1);
	const parsed = await zcodeAdapter.parse(findMeta(metas, "ses_v2"));
	assert.equal(parsed.slug, "Fix the loader");
	assert.equal(parsed.projectDir, "/home/me/v2-app");
	assert.deepEqual(
		parsed.messages.map((message) => [message.id, message.type]),
		[
			["msg_v2_u", "user"],
			["msg_v2_a", "assistant"],
		],
	);
	assert.equal(parsed.messages[1]?.thinking, "It scans every file.");
	assert.equal(parsed.messages[1]?.hasToolUse, true);
});

test("scans a WSL distro root beside the local ZCode home", async () => {
	const localDir = useDataDir();
	const wslHome = mkdtempSync(join(baseDir, "wsl-home-"));
	const wslRoot = join(wslHome, ".zcode");
	const userAt = 1792000000000;

	await writeZcodeDb(localDir, (db) => {
		db.exec(V1_SCHEMA);
		db.run(
			`INSERT INTO session (id, project_id, slug, directory, title, title_source, version, time_created, time_updated)
			 VALUES ('ses_local', 'p', 's', 'C:\\work\\local', 'Local ZCode session', 'ai', '0.16.9', ?, ?)`,
			[userAt, userAt],
		);
		db.run(
			`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('msg_l', 'ses_local', ?, ?, ?)`,
			[
				userAt,
				userAt,
				JSON.stringify({
					id: "msg_l",
					role: "user",
					time: { created: userAt },
					semantics: { origin: "real_user" },
				}),
			],
		);
		db.run(
			`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('prt_l', 'msg_l', 'ses_local', ?, ?, ?)`,
			[userAt, userAt, JSON.stringify({ type: "text", text: "local prompt" })],
		);
	});

	const wslDbPath = await writeZcodeDb(wslRoot, (db) => {
		db.exec(V2_SCHEMA);
		db.run(
			`INSERT INTO session_v2 (id, project_id, workspace_id, parent_id, slug, directory, title, title_source, version, time_created, time_updated)
			 VALUES ('ses_wsl', 'p', NULL, NULL, 'ses_wsl', '/home/me/wsl-app', 'WSL ZCode session', 'ai', '0.16.9', ?, ?)`,
			[userAt + 1000, userAt + 1000],
		);
		db.run(
			`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
			 VALUES ('msg_w', 'ses_wsl', 'user', 1, ?, ?, ?)`,
			[
				userAt + 1000,
				userAt + 1000,
				JSON.stringify({
					time: { created: userAt + 1000 },
					text: "wsl prompt",
				}),
			],
		);
	});

	setWslHomesForTesting([wslHome]);
	try {
		const info = await zcodeAdapter.detect();
		assert.ok(info);
		assert.equal(info.dataDir, localDir);
		assert.equal(info.conversationCount, 2);

		const metas = await zcodeAdapter.scan();
		assert.equal(metas.length, 2);

		const local = findMeta(metas, "ses_local");
		assert.equal(local.rootDir, localDir);

		const wsl = findMeta(metas, "ses_wsl");
		assert.equal(wsl.rootDir, wslRoot);
		assert.equal(wsl.filePath, wslDbPath);

		const parsed = await zcodeAdapter.parse(wsl);
		assert.equal(parsed.id, "ses_wsl");
		assert.equal(parsed.slug, "WSL ZCode session");
		assert.equal(parsed.projectDir, "/home/me/wsl-app");
		assert.deepEqual(
			parsed.messages.map((message) => message.content),
			["wsl prompt"],
		);

		// The watcher never targets the distro's UNC paths.
		assert.deepEqual(
			zcodeAdapter.watchPaths?.() ?? [],
			[join(localDir, "cli", "db", "db.sqlite")],
		);
	} finally {
		setWslHomesForTesting(null);
	}
});

test("watchPaths returns the local database only when it exists", async () => {
	const dir = useDataDir();
	assert.deepEqual(zcodeAdapter.watchPaths?.() ?? [], []);
	const dbPath = await writeZcodeDb(dir, (db) => {
		db.exec(V1_SCHEMA);
	});
	assert.deepEqual(zcodeAdapter.watchPaths?.() ?? [], [dbPath]);
});
