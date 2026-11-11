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

// The adapter reads its data directory from appConfig, which is populated when
// the config module is first imported. Point the env var at a fixture root
// before importing the adapter.
const fixtureRoot = mkdtempSync(join(tmpdir(), "chatcrystal-opencode-"));
const wslBaseDir = mkdtempSync(join(tmpdir(), "chatcrystal-opencode-wsl-"));
process.env.OPENCODE_DATA_DIR = fixtureRoot;

const { opencodeAdapter } = await import("./opencode.js");
const { setWslHomesForTesting } = await import("../wsl.js");

after(() => {
	setWslHomesForTesting(null);
	rmSync(fixtureRoot, { recursive: true, force: true });
	rmSync(wslBaseDir, { recursive: true, force: true });
});

const dbPath = join(fixtureRoot, "opencode.db");

function resetFixtureRoot(): void {
	rmSync(fixtureRoot, { recursive: true, force: true });
	mkdirSync(fixtureRoot, { recursive: true });
}

function writeFixture(relativePath: string, content: string): string {
	const filePath = join(fixtureRoot, relativePath);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, content, "utf-8");
	return filePath;
}

function writeJsonFixture(relativePath: string, value: unknown): string {
	return writeFixture(relativePath, JSON.stringify(value, null, 2));
}

/** Build a throwaway SQLite file with the given setup statements. */
async function writeDatabase(
	setup: (db: Database) => void,
	root = fixtureRoot,
	fileName = "opencode.db",
): Promise<void> {
	const SQL = await initSqlJs({ locateFile: locateSqlJsFile });
	const db = new SQL.Database();
	try {
		setup(db);
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, fileName), Buffer.from(db.export()));
	} finally {
		db.close();
	}
}

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

const V1_SCHEMA = `
	CREATE TABLE session (
		id TEXT PRIMARY KEY,
		project_id TEXT NOT NULL,
		slug TEXT NOT NULL,
		directory TEXT NOT NULL,
		title TEXT NOT NULL,
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

function findMeta(
	metas: Awaited<ReturnType<typeof opencodeAdapter.scan>>,
	id: string,
) {
	const meta = metas.find((item) => item.id === id);
	assert.ok(meta, `expected scanned conversation ${id}`);
	return meta;
}

test("detect returns null and scan is empty when no store exists", async () => {
	resetFixtureRoot();
	assert.equal(await opencodeAdapter.detect(), null);
	assert.deepEqual(await opencodeAdapter.scan(), []);
});

test("parses an OpenCode 2 store (session_v2 + session_message)", async () => {
	resetFixtureRoot();

	const createdAt = 1790102970000;
	const userAt = 1790102971000;
	const assistantAt = 1790102977894;
	const user2At = 1790102990000;

	await writeDatabase((db) => {
		db.exec(V2_SCHEMA);
		db.run(
			`INSERT INTO session_v2 (id, project_id, workspace_id, parent_id, slug, directory, title, version, time_created, time_updated)
			 VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
			[
				"ses_parent",
				"proj_1",
				"ses_parent",
				"/home/fixture/opencode-app",
				"Fix the parser bug",
				"1.2.0",
				createdAt,
				user2At,
			],
		);
		// A subagent run is a session of its own whose parent is the session it
		// ran in; its placeholder title must not become the slug.
		db.run(
			`INSERT INTO session_v2 (id, project_id, workspace_id, parent_id, slug, directory, title, version, time_created, time_updated)
			 VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
			[
				"ses_child",
				"proj_1",
				"ses_parent",
				"ses_child",
				"/home/fixture/opencode-app",
				"Child session - 2026-09-22T10:00:00.000Z",
				"1.2.0",
				createdAt,
				createdAt,
			],
		);

		const insertMessage = (
			id: string,
			sessionId: string,
			type: string,
			seq: number,
			data: unknown,
		): void => {
			db.run(
				`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[id, sessionId, type, seq, createdAt, createdAt, JSON.stringify(data)],
			);
		};

		insertMessage("msg_u1", "ses_parent", "user", 1, {
			time: { created: userAt },
			text: "edit main.go so add returns a+b+1",
		});
		insertMessage("msg_a1", "ses_parent", "assistant", 2, {
			time: { created: assistantAt, completed: assistantAt + 3000 },
			agent: "build",
			model: { id: "claude", providerID: "anthropic" },
			content: [
				{ type: "step-start" },
				{ type: "reasoning", text: "Need to change add." },
				{
					type: "tool",
					name: "shell",
					state: {
						status: "completed",
						input: { command: "go vet ./..." },
						content: [{ type: "text", text: "ok" }],
					},
				},
				{ type: "text", text: "add now returns a+b+1" },
				{ type: "step-finish" },
				{ type: "snapshot", snapshot: "sha" },
			],
		});
		// OpenCode's own bookkeeping, not a conversation turn.
		insertMessage("msg_compact", "ses_parent", "compaction", 3, {
			time: { created: assistantAt + 1000 },
			summary: "compressed history",
		});
		insertMessage("msg_u2", "ses_parent", "user", 4, {
			time: { created: user2At },
			text: "thanks",
		});
		// Corrupt and empty documents must be skipped without throwing.
		db.run(
			`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				"msg_broken",
				"ses_parent",
				"assistant",
				5,
				createdAt,
				createdAt,
				"{\"content\":",
			],
		);
		insertMessage("msg_empty", "ses_parent", "user", 6, {
			time: { created: user2At },
			text: "",
		});
	});

	const info = await opencodeAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "opencode");
	assert.equal(info.displayName, "OpenCode");
	assert.equal(info.dataDir, fixtureRoot);
	assert.equal(info.conversationCount, 2);

	const metas = await opencodeAdapter.scan();
	assert.equal(metas.length, 2);
	const meta = findMeta(metas, "ses_parent");
	assert.equal(meta.source, "opencode");
	assert.equal(meta.filePath, dbPath);
	assert.ok(meta.fileSize > 0);
	assert.equal(meta.projectDir, "/home/fixture/opencode-app");
	assert.ok(!Number.isNaN(Date.parse(meta.fileMtime)));
	assert.ok(findMeta(metas, "ses_child"));

	const parsed = await opencodeAdapter.parse(meta);
	assert.equal(parsed.id, "ses_parent");
	assert.equal(parsed.source, "opencode");
	assert.equal(parsed.slug, "Fix the parser bug");
	assert.equal(parsed.projectDir, "/home/fixture/opencode-app");
	assert.equal(parsed.projectName, "opencode-app");
	assert.equal(parsed.cwd, "/home/fixture/opencode-app");
	assert.equal(parsed.gitBranch, null);

	assert.deepEqual(
		parsed.messages.map((message) => message.id),
		["msg_u1", "msg_a1", "msg_u2"],
	);
	assert.deepEqual(
		parsed.messages.map((message) => message.type),
		["user", "assistant", "user"],
	);

	const assistantMessage = parsed.messages[1];
	assert.equal(assistantMessage.content, "add now returns a+b+1");
	assert.equal(assistantMessage.thinking, "Need to change add.");
	assert.equal(assistantMessage.hasToolUse, true);
	assert.equal(assistantMessage.hasCode, false);
	assert.equal(assistantMessage.timestamp, new Date(assistantAt).toISOString());
	assert.deepEqual(assistantMessage, {
		id: "msg_a1",
		parentUuid: null,
		type: "assistant",
		role: "assistant",
		content: "add now returns a+b+1",
		hasToolUse: true,
		hasCode: false,
		thinking: "Need to change add.",
		timestamp: new Date(assistantAt).toISOString(),
	});

	assert.equal(parsed.messages[0].content, "edit main.go so add returns a+b+1");
	assert.equal(parsed.firstMessageAt, new Date(userAt).toISOString());
	assert.equal(parsed.lastMessageAt, new Date(user2At).toISOString());

	const child = await opencodeAdapter.parse(findMeta(metas, "ses_child"));
	assert.equal(child.id, "ses_child");
	assert.equal(child.slug, null);
	assert.deepEqual(child.messages, []);
});

test("parses an OpenCode 1 store (session + message + part)", async () => {
	resetFixtureRoot();

	const messageAt = 1780000001000;

	await writeDatabase((db) => {
		db.exec(V1_SCHEMA);
		db.run(
			`INSERT INTO session (id, project_id, slug, directory, title, parent_id, version, time_created, time_updated)
			 VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
			[
				"ses_v1",
				"proj_1",
				"ses_v1",
				"/home/fixture/v1-app",
				"Refactor session loader",
				"1.0.0",
				messageAt,
				messageAt + 5000,
			],
		);
		db.run(
			`INSERT INTO message (id, session_id, time_created, time_updated, data)
			 VALUES (?, ?, ?, ?, ?)`,
			[
				"msg_1",
				"ses_v1",
				messageAt,
				messageAt,
				JSON.stringify({ role: "user", time: { created: messageAt } }),
			],
		);
		db.run(
			`INSERT INTO message (id, session_id, time_created, time_updated, data)
			 VALUES (?, ?, ?, ?, ?)`,
			[
				"msg_2",
				"ses_v1",
				messageAt + 1000,
				messageAt + 1000,
				JSON.stringify({
					role: "assistant",
					time: { created: messageAt + 1000, completed: messageAt + 2000 },
				}),
			],
		);
		const insertPart = (
			id: string,
			messageId: string,
			data: unknown,
		): void => {
			db.run(
				`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
				 VALUES (?, ?, 'ses_v1', ?, ?, ?)`,
				[
					id,
					messageId,
					messageAt,
					messageAt,
					JSON.stringify(data),
				],
			);
		};
		insertPart("p1", "msg_1", { type: "text", text: "Why is the loader slow?" });
		insertPart("p2", "msg_2", { type: "reasoning", text: "Check the loop." });
		insertPart("p3", "msg_2", {
			type: "text",
			text: "It scans every file.",
		});
		insertPart("p4", "msg_2", {
			type: "tool",
			name: "read",
			state: { status: "completed", input: { filePath: "loader.ts" } },
		});
		insertPart("p5", "msg_2", { type: "step-start" });
		insertPart("p6", "msg_2", {
			type: "text",
			text: "internal note",
			ignored: true,
		});
	});

	const metas = await opencodeAdapter.scan();
	assert.equal(metas.length, 1);
	const meta = findMeta(metas, "ses_v1");
	assert.equal(meta.filePath, dbPath);
	assert.equal(meta.projectDir, "/home/fixture/v1-app");

	const parsed = await opencodeAdapter.parse(meta);
	assert.equal(parsed.slug, "Refactor session loader");
	assert.equal(parsed.projectName, "v1-app");
	assert.equal(parsed.cwd, "/home/fixture/v1-app");
	assert.deepEqual(
		parsed.messages.map((message) => message.id),
		["msg_1", "msg_2"],
	);

	const assistantMessage = parsed.messages[1];
	assert.equal(assistantMessage.content, "It scans every file.");
	assert.equal(assistantMessage.thinking, "Check the loop.");
	assert.equal(assistantMessage.hasToolUse, true);
	assert.equal(assistantMessage.timestamp, new Date(messageAt + 1000).toISOString());
	// Parts marked ignored by OpenCode itself are not conversation text.
	assert.ok(!assistantMessage.content.includes("internal note"));
});

test("reads legacy JSON storage when the database is absent", async () => {
	resetFixtureRoot();

	writeJsonFixture(join("storage", "session", "proj_legacy", "ses_store.json"), {
		id: "ses_store",
		title: "Legacy storage session",
		directory: "/home/fixture/storage-app",
		time: { created: 1760000000000, updated: 1760000005000 },
	});
	writeJsonFixture(join("storage", "message", "ses_store", "msg_1.json"), {
		role: "user",
		time: { created: 1760000001000 },
	});
	writeJsonFixture(join("storage", "part", "msg_1", "part_1.json"), {
		type: "text",
		text: "hello from storage",
		time: { start: 1760000001000 },
	});
	writeJsonFixture(join("storage", "message", "ses_store", "msg_2.json"), {
		role: "assistant",
		time: { created: 1760000002000 },
	});
	writeJsonFixture(join("storage", "part", "msg_2", "part_1.json"), {
		type: "reasoning",
		text: "Reasoning from the old store.",
	});
	writeJsonFixture(join("storage", "part", "msg_2", "part_2.json"), {
		type: "text",
		text: "Answer from the old store.",
	});
	writeJsonFixture(join("storage", "part", "msg_2", "part_3.json"), {
		type: "tool",
		name: "bash",
		state: { status: "completed", input: { command: "ls" } },
	});
	// Corrupt storage documents are skipped.
	writeFixture(
		join("storage", "session", "proj_legacy", "broken.json"),
		"{ not json",
	);

	const info = await opencodeAdapter.detect();
	assert.ok(info);
	assert.equal(info.conversationCount, 1);

	const metas = await opencodeAdapter.scan();
	assert.equal(metas.length, 1);
	const meta = findMeta(metas, "ses_store");
	assert.equal(meta.source, "opencode");
	assert.ok(meta.filePath.endsWith("ses_store.json"));
	assert.equal(meta.projectDir, "/home/fixture/storage-app");
	assert.ok(meta.fileSize > 0);

	const parsed = await opencodeAdapter.parse(meta);
	assert.equal(parsed.id, "ses_store");
	assert.equal(parsed.slug, "Legacy storage session");
	assert.equal(parsed.projectDir, "/home/fixture/storage-app");
	assert.equal(parsed.projectName, "storage-app");
	assert.deepEqual(
		parsed.messages.map((message) => message.id),
		["msg_1", "msg_2"],
	);
	assert.equal(parsed.messages[0].content, "hello from storage");
	assert.equal(
		parsed.messages[1].content,
		"Answer from the old store.",
	);
	assert.equal(
		parsed.messages[1].thinking,
		"Reasoning from the old store.",
	);
	assert.equal(parsed.messages[1].hasToolUse, true);
	assert.equal(
		parsed.messages[1].timestamp,
		new Date(1760000002000).toISOString(),
	);
});

test("scans a WSL distro root beside the local data dir", async () => {
	resetFixtureRoot();

	const wslHome = join(wslBaseDir, "home");
	rmSync(wslHome, { recursive: true, force: true });
	const wslRoot = join(wslHome, ".local", "share", "opencode");

	// One conversation lives in the Windows install, one in the WSL distro;
	// each root has its own SQLite database and the cache must not mix them.
	const createdAt = 1792000000000;
	await writeDatabase((db) => {
		db.exec(V2_SCHEMA);
		db.run(
			`INSERT INTO session_v2 (id, project_id, workspace_id, parent_id, slug, directory, title, version, time_created, time_updated)
			 VALUES ('ses_local', 'proj_local', NULL, NULL, 'ses_local', 'C:\\work\\local-app', 'Local session', '1.2.0', ?, ?)`,
			[createdAt, createdAt],
		);
		db.run(
			`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
			 VALUES ('msg_local', 'ses_local', 'user', 1, ?, ?, ?)`,
			[createdAt, createdAt, JSON.stringify({ time: { created: createdAt }, text: "local prompt" })],
		);
	});
	await writeDatabase((db) => {
		db.exec(V2_SCHEMA);
		db.run(
			`INSERT INTO session_v2 (id, project_id, workspace_id, parent_id, slug, directory, title, version, time_created, time_updated)
			 VALUES ('ses_wsl', 'proj_wsl', NULL, NULL, 'ses_wsl', '/home/me/wsl-app', 'WSL session', '1.2.0', ?, ?)`,
			[createdAt + 1000, createdAt + 1000],
		);
		db.run(
			`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
			 VALUES ('msg_wsl', 'ses_wsl', 'user', 1, ?, ?, ?)`,
			[
				createdAt + 1000,
				createdAt + 1000,
				JSON.stringify({
					time: { created: createdAt + 1000 },
					text: "wsl prompt",
				}),
			],
		);
	}, wslRoot);

	setWslHomesForTesting([wslHome]);
	try {
		const info = await opencodeAdapter.detect();
		assert.ok(info);
		// The reported data dir stays the primary Windows root.
		assert.equal(info.dataDir, fixtureRoot);
		assert.equal(info.conversationCount, 2);

		const metas = await opencodeAdapter.scan();
		assert.equal(metas.length, 2);

		const localMeta = findMeta(metas, "ses_local");
		const wslMeta = findMeta(metas, "ses_wsl");
		assert.equal(localMeta.rootDir, fixtureRoot);
		assert.equal(localMeta.filePath, dbPath);
		assert.equal(wslMeta.rootDir, wslRoot);
		assert.equal(wslMeta.filePath, join(wslRoot, "opencode.db"));

		const local = await opencodeAdapter.parse(localMeta);
		assert.equal(local.id, localMeta.id);
		assert.equal(local.slug, "Local session");
		assert.deepEqual(
			local.messages.map((message) => message.content),
			["local prompt"],
		);

		const wsl = await opencodeAdapter.parse(wslMeta);
		assert.equal(wsl.id, wslMeta.id);
		assert.equal(wsl.slug, "WSL session");
		assert.equal(wsl.projectDir, "/home/me/wsl-app");
		assert.equal(wsl.projectName, "wsl-app");
		assert.deepEqual(
			wsl.messages.map((message) => message.content),
			["wsl prompt"],
		);
	} finally {
		setWslHomesForTesting(null);
	}
});

test("scans a WSL distro root with legacy JSON storage", async () => {
	resetFixtureRoot();

	const wslHome = join(wslBaseDir, "home-legacy");
	rmSync(wslHome, { recursive: true, force: true });
	const wslRoot = join(wslHome, ".local", "share", "opencode");

	const writeWslJson = (relativePath: string, value: unknown): void => {
		const filePath = join(wslRoot, relativePath);
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
	};
	writeWslJson(join("storage", "session", "proj_wsl", "ses_wsl_store.json"), {
		id: "ses_wsl_store",
		title: "WSL storage session",
		directory: "/home/me/wsl-legacy",
		time: { created: 1762000000000 },
	});
	writeWslJson(join("storage", "message", "ses_wsl_store", "msg_1.json"), {
		role: "user",
		time: { created: 1762000001000 },
	});
	writeWslJson(join("storage", "part", "msg_1", "part_1.json"), {
		type: "text",
		text: "hello from wsl storage",
	});

	setWslHomesForTesting([wslHome]);
	try {
		const info = await opencodeAdapter.detect();
		assert.ok(info);
		assert.equal(info.conversationCount, 1);

		const metas = await opencodeAdapter.scan();
		assert.equal(metas.length, 1);
		const meta = findMeta(metas, "ses_wsl_store");
		assert.equal(meta.rootDir, wslRoot);
		assert.equal(meta.filePath, join(wslRoot, "storage", "session", "proj_wsl", "ses_wsl_store.json"));

		const parsed = await opencodeAdapter.parse(meta);
		assert.equal(parsed.slug, "WSL storage session");
		assert.equal(parsed.projectDir, "/home/me/wsl-legacy");
		// Message/part sibling folders are resolved against the WSL root, not
		// the primary Windows data dir.
		assert.deepEqual(
			parsed.messages.map((message) => message.content),
			["hello from wsl storage"],
		);
	} finally {
		setWslHomesForTesting(null);
	}
});

test("tolerates a corrupt database file", async () => {
	resetFixtureRoot();
	writeFixture("opencode.db", "this is not a sqlite database");
	assert.equal(await opencodeAdapter.detect(), null);
	assert.deepEqual(await opencodeAdapter.scan(), []);
});

test("watchPaths returns the live files that exist", async () => {
	resetFixtureRoot();
	assert.deepEqual(opencodeAdapter.watchPaths?.() ?? [], []);

	await writeDatabase((db) => {
		db.exec(V2_SCHEMA);
		db.run(
			`INSERT INTO session_v2 (id, project_id, workspace_id, parent_id, slug, directory, title, version, time_created, time_updated)
			 VALUES ('ses_watch', 'proj_1', NULL, NULL, 'ses_watch', '/tmp/app', 'watch me', '1.0.0', 1, 2)`,
		);
	});
	assert.deepEqual(opencodeAdapter.watchPaths?.() ?? [], [dbPath]);

	rmSync(dbPath);
	mkdirSync(join(fixtureRoot, "storage"), { recursive: true });
	const paths = opencodeAdapter.watchPaths?.() ?? [];
	assert.equal(paths.length, 1);
	assert.ok(paths[0].includes("storage"));
	assert.ok(paths[0].includes("**"));
});
