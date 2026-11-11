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
// Each test points appConfig at its own temporary Hermes home.
const baseDir = mkdtempSync(join(tmpdir(), "chatcrystal-hermes-"));
process.env.HERMES_HOME = baseDir;

const { appConfig } = await import("../../config.js");
const { hermesAdapter } = await import("./hermes.js");
const { setWslHomesForTesting } = await import("../wsl.js");

after(() => {
	setWslHomesForTesting(null);
	rmSync(baseDir, { recursive: true, force: true });
});

function useDataDir(): string {
	const dir = mkdtempSync(join(baseDir, "data-"));
	appConfig.hermesDataDir = dir;
	return dir;
}

/** Write a `state.db` from a throwaway sql.js database. */
async function writeStateDb(
	dbPath: string,
	setup: (db: Database) => void,
): Promise<string> {
	const SQL = await initSqlJs({ locateFile: locateSqlJsFile });
	const db = new SQL.Database();
	try {
		setup(db);
		mkdirSync(dirname(dbPath), { recursive: true });
		writeFileSync(dbPath, Buffer.from(db.export()));
		return dbPath;
	} finally {
		db.close();
	}
}

const BASE_SECONDS = Date.UTC(2026, 8, 28, 10, 0, 0) / 1000;

function isoAt(seconds: number): string {
	return new Date(seconds * 1000).toISOString();
}

function jsonContent(text: string): string {
	return `\u0000json:${JSON.stringify([{ type: "text", text }])}`;
}

function findMeta(
	metas: Awaited<ReturnType<typeof hermesAdapter.scan>>,
	id: string,
) {
	const meta = metas.find((item) => item.id === id);
	assert.ok(meta, `expected scanned conversation ${id}`);
	return meta;
}

/** The schema early Hermes releases wrote (no bookkeeping columns). */
const LEGACY_SCHEMA = `
	CREATE TABLE sessions (
		id TEXT PRIMARY KEY,
		title TEXT,
		cwd TEXT,
		model TEXT,
		started_at REAL,
		ended_at REAL,
		last_activity_at REAL
	);
	CREATE TABLE messages (
		id INTEGER PRIMARY KEY,
		session_id TEXT,
		role TEXT,
		content TEXT,
		tool_calls TEXT,
		timestamp REAL
	);
`;

test("detect returns null and scan is empty when no store exists", async () => {
	const dir = useDataDir();
	assert.equal(await hermesAdapter.detect(), null);
	assert.deepEqual(await hermesAdapter.scan(), []);
	assert.deepEqual(hermesAdapter.watchPaths?.(), []);

	// A state.db without Hermes's tables is not a store.
	await writeStateDb(join(dir, "state.db"), (db) => {
		db.exec("CREATE TABLE unrelated (id TEXT)");
	});
	assert.equal(await hermesAdapter.detect(), null);
});

test("detect, scan and parse the legacy store", async () => {
	const dir = useDataDir();
	const dbPath = await writeStateDb(join(dir, "state.db"), (db) => {
		db.exec(LEGACY_SCHEMA);
		db.run(
			`INSERT INTO sessions (id, title, cwd, model, started_at, ended_at, last_activity_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				"ses_hermes_1",
				"A Hermes task",
				"/work/hermes",
				"fallback-model",
				BASE_SECONDS,
				BASE_SECONDS + 9,
				BASE_SECONDS + 12,
			],
		);
		const insertMessage = (
			id: number,
			role: string,
			content: string,
			toolCalls: string,
			at: number,
		): void => {
			db.run(
				"INSERT INTO messages (id, session_id, role, content, tool_calls, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
				[id, "ses_hermes_1", role, content, toolCalls, at],
			);
		};
		insertMessage(1, "user", jsonContent("Please inspect this"), "[]", BASE_SECONDS + 1);
		insertMessage(
			2,
			"assistant",
			JSON.stringify([{ type: "text", text: "I will inspect it" }]),
			JSON.stringify([{ function: { name: "read_file" } }]),
			BASE_SECONDS + 4,
		);
		// Tool results are not conversation turns.
		insertMessage(
			3,
			"tool",
			JSON.stringify([{ type: "text", text: "file contents" }]),
			"[]",
			BASE_SECONDS + 7,
		);
		insertMessage(
			4,
			"assistant",
			JSON.stringify([{ type: "text", text: "Done" }]),
			"[]",
			BASE_SECONDS + 12,
		);
	});

	const info = await hermesAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "hermes");
	assert.equal(info.displayName, "Hermes");
	assert.equal(info.dataDir, dir);
	assert.equal(info.conversationCount, 1);

	const metas = await hermesAdapter.scan();
	assert.equal(metas.length, 1);
	const meta = findMeta(metas, "ses_hermes_1");
	assert.equal(meta.source, "hermes");
	assert.equal(meta.filePath, dbPath);
	assert.equal(meta.rootDir, dir);
	assert.equal(meta.projectDir, "/work/hermes");
	// A shared store cannot identify one session by size.
	assert.equal(meta.fileSize, 0);
	assert.equal(meta.fileMtime, isoAt(BASE_SECONDS + 12));

	const parsed = await hermesAdapter.parse(meta);
	assert.equal(parsed.id, meta.id);
	assert.equal(parsed.source, "hermes");
	assert.equal(parsed.slug, "A Hermes task");
	assert.equal(parsed.projectDir, "/work/hermes");
	assert.equal(parsed.projectName, "hermes");
	assert.equal(parsed.cwd, "/work/hermes");
	assert.equal(parsed.gitBranch, null);

	assert.deepEqual(
		parsed.messages.map((message) => [message.id, message.type, message.content]),
		[
			["1", "user", "Please inspect this"],
			["2", "assistant", "I will inspect it"],
			["4", "assistant", "Done"],
		],
	);
	assert.equal(parsed.messages[1]?.hasToolUse, true);
	assert.equal(parsed.messages[1]?.thinking, null);
	assert.equal(parsed.messages[1]?.timestamp, isoAt(BASE_SECONDS + 4));
	assert.equal(parsed.firstMessageAt, isoAt(BASE_SECONDS + 1));
	assert.equal(parsed.lastMessageAt, isoAt(BASE_SECONDS + 12));

	// Only the local store is watched.
	assert.deepEqual(hermesAdapter.watchPaths?.(), [dbPath]);
});

test("newer schemas hide inactive and model-only rows", async () => {
	const dir = useDataDir();
	await writeStateDb(join(dir, "state.db"), (db) => {
		db.exec(`
			CREATE TABLE sessions (
				id TEXT PRIMARY KEY, title TEXT, cwd TEXT, started_at REAL, ended_at REAL, last_activity_at REAL
			);
			CREATE TABLE messages (
				id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT,
				tool_call_id TEXT, tool_name TEXT, display_kind TEXT, display_metadata TEXT,
				timestamp REAL, active INTEGER, compacted INTEGER
			);
		`);
		db.run(
			"INSERT INTO sessions (id, title, cwd) VALUES ('ses_new', 'Newer schema', '/work/new')",
		);
		const insert = (
			id: number,
			role: string,
			text: string,
			metadata: string,
			active: number,
			compacted: number,
		): void => {
			db.run(
				`INSERT INTO messages (id, session_id, role, content, tool_calls, display_metadata, timestamp, active, compacted)
				 VALUES (?, 'ses_new', ?, ?, '[]', ?, ?, ?, ?)`,
				[
					id,
					role,
					JSON.stringify([{ type: "text", text }]),
					metadata,
					BASE_SECONDS + id,
					active,
					compacted,
				],
			);
		};
		insert(1, "user", "first prompt", "{}", 1, 0);
		insert(2, "assistant", "model scaffolding", '{"model_only":true}', 1, 0);
		insert(3, "assistant", "rewound answer", "{}", 0, 0);
		insert(4, "assistant", "kept compacted tail", "{}", 0, 1);
		insert(5, "user", "second prompt", "{}", 1, 0);
	});

	const metas = await hermesAdapter.scan();
	assert.equal(metas.length, 1);
	const parsed = await hermesAdapter.parse(findMeta(metas, "ses_new"));
	assert.deepEqual(
		parsed.messages.map((message) => message.content),
		["first prompt", "kept compacted tail", "second prompt"],
	);
	assert.equal(parsed.slug, "Newer schema");
});

test("scans named profile stores and deduplicates colliding ids", async () => {
	const dir = useDataDir();
	await writeStateDb(join(dir, "state.db"), (db) => {
		db.exec(LEGACY_SCHEMA);
		db.run(
			"INSERT INTO sessions (id, title, cwd, started_at) VALUES ('same-id', 'Default profile', '/work/default', ?)",
			[BASE_SECONDS],
		);
		db.run(
			`INSERT INTO messages (id, session_id, role, content, tool_calls, timestamp)
			 VALUES (1, 'same-id', 'user', ?, '[]', ?)`,
			[jsonContent("default prompt"), BASE_SECONDS + 1],
		);
	});
	const profilePath = await writeStateDb(
		join(dir, "profiles", "work", "state.db"),
		(db) => {
			db.exec(LEGACY_SCHEMA);
			db.run(
				"INSERT INTO sessions (id, title, cwd, started_at) VALUES ('profile-id', 'Work profile', '/work/profile', ?)",
				[BASE_SECONDS + 100],
			);
			db.run(
				`INSERT INTO messages (id, session_id, role, content, tool_calls, timestamp)
				 VALUES (1, 'profile-id', 'user', ?, '[]', ?)`,
				[jsonContent("profile prompt"), BASE_SECONDS + 101],
			);
		},
	);
	// A copied session id in another profile must not duplicate a meta.
	await writeStateDb(join(dir, "profiles", "copy", "state.db"), (db) => {
		db.exec(LEGACY_SCHEMA);
		db.run(
			"INSERT INTO sessions (id, title, cwd) VALUES ('same-id', 'Copied profile', '/work/copied')",
		);
	});

	const info = await hermesAdapter.detect();
	assert.ok(info);
	assert.equal(info.conversationCount, 2);

	const metas = await hermesAdapter.scan();
	assert.deepEqual(metas.map((meta) => meta.id).sort(), ["profile-id", "same-id"]);
	const profile = findMeta(metas, "profile-id");
	assert.equal(profile.filePath, profilePath);
	assert.equal(profile.rootDir, dir);
	assert.equal(profile.projectDir, "/work/profile");

	const parsed = await hermesAdapter.parse(profile);
	assert.equal(parsed.slug, "Work profile");
	assert.deepEqual(
		parsed.messages.map((message) => message.content),
		["profile prompt"],
	);
});

test("scans a WSL distro root beside the local Hermes home", async () => {
	const localDir = useDataDir();
	const wslHome = mkdtempSync(join(baseDir, "wsl-home-"));
	const wslRoot = join(wslHome, ".hermes");
	const wslDbPath = await writeStateDb(join(wslRoot, "state.db"), (db) => {
		db.exec(LEGACY_SCHEMA);
		db.run(
			"INSERT INTO sessions (id, title, cwd, started_at) VALUES ('ses_wsl', 'WSL Hermes task', '/home/me/wsl-hermes', ?)",
			[BASE_SECONDS + 200],
		);
		db.run(
			`INSERT INTO messages (id, session_id, role, content, tool_calls, timestamp)
			 VALUES (1, 'ses_wsl', 'user', ?, '[]', ?)`,
			[jsonContent("wsl prompt"), BASE_SECONDS + 201],
		);
		db.run(
			`INSERT INTO messages (id, session_id, role, content, tool_calls, timestamp)
			 VALUES (2, 'ses_wsl', 'assistant', ?, '[]', ?)`,
			[
				JSON.stringify([{ type: "text", text: "wsl reply" }]),
				BASE_SECONDS + 202,
			],
		);
	});
	const localDbPath = await writeStateDb(join(localDir, "state.db"), (db) => {
		db.exec(LEGACY_SCHEMA);
		db.run(
			"INSERT INTO sessions (id, title, cwd) VALUES ('ses_local', 'Local Hermes task', 'C:\\work\\local-hermes')",
		);
		db.run(
			`INSERT INTO messages (id, session_id, role, content, tool_calls, timestamp)
			 VALUES (1, 'ses_local', 'user', ?, '[]', ?)`,
			[jsonContent("local prompt"), BASE_SECONDS],
		);
	});

	setWslHomesForTesting([wslHome]);
	try {
		const info = await hermesAdapter.detect();
		assert.ok(info);
		assert.equal(info.dataDir, localDir);
		assert.equal(info.conversationCount, 2);

		const metas = await hermesAdapter.scan();
		assert.equal(metas.length, 2);

		const local = findMeta(metas, "ses_local");
		assert.equal(local.rootDir, localDir);

		const wsl = findMeta(metas, "ses_wsl");
		assert.equal(wsl.rootDir, wslRoot);
		assert.equal(wsl.filePath, wslDbPath);
		assert.equal(wsl.projectDir, "/home/me/wsl-hermes");

		const parsed = await hermesAdapter.parse(wsl);
		assert.equal(parsed.id, "ses_wsl");
		assert.equal(parsed.slug, "WSL Hermes task");
		assert.equal(parsed.projectDir, "/home/me/wsl-hermes");
		assert.deepEqual(
			parsed.messages.map((message) => message.content),
			["wsl prompt", "wsl reply"],
		);

		// The watcher never targets the distro's UNC paths.
		assert.deepEqual(hermesAdapter.watchPaths?.(), [localDbPath]);
	} finally {
		setWslHomesForTesting(null);
	}
});
