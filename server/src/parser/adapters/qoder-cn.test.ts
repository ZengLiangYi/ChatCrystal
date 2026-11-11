import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

// The adapter reads its data folder from appConfig, which is populated when the
// config module is first imported. Point the env var at a fixture root before
// importing the adapter.
const fixtureRoot = mkdtempSync(join(tmpdir(), "chatcrystal-qoder-cn-"));
const wslHome = mkdtempSync(join(tmpdir(), "chatcrystal-qoder-cn-wsl-home-"));
const wslRoot = join(wslHome, ".qoder-cn");
process.env.QODERCN_CONFIG_DIR = fixtureRoot;
process.env.CHATCRYSTAL_WSL = "0";

const { qoderCnAdapter } = await import("./qoder-cn.js");
const { setWslHomesForTesting } = await import("../wsl.js");

const MANGLED_PROJECT = "C--Users-fixture-code-cn-app";
const CWD = "C:\\Users\\fixture\\code\\cn-app";

after(() => {
	setWslHomesForTesting(null);
	rmSync(fixtureRoot, { recursive: true, force: true });
	rmSync(wslHome, { recursive: true, force: true });
});

function resetFixtureRoot(): void {
	rmSync(fixtureRoot, { recursive: true, force: true });
	mkdirSync(fixtureRoot, { recursive: true });
}

function writeJsonlFixture(
	root: string,
	relativePath: string,
	lines: unknown[],
): string {
	const filePath = join(root, relativePath);
	mkdirSync(dirname(filePath), { recursive: true });
	const content = `${lines
		.map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
		.join("\n")}\n`;
	writeFileSync(filePath, content, "utf-8");
	return filePath;
}

function claudeLine(options: {
	uuid: string;
	parentUuid?: string | null;
	type: "user" | "assistant";
	content: string;
	cwd: string;
	timestamp: string;
}): string {
	return JSON.stringify({
		uuid: options.uuid,
		parentUuid: options.parentUuid ?? null,
		type: options.type,
		sessionId: "cn-session-one",
		cwd: options.cwd,
		timestamp: options.timestamp,
		message: { role: options.type, content: options.content },
	});
}

test("detect returns null and scan is empty when no sessions exist", async () => {
	resetFixtureRoot();
	assert.equal(await qoderCnAdapter.detect(), null);
	assert.deepEqual(await qoderCnAdapter.scan(), []);
});

test("parses a Qoder CN transcript with the qoder-cn source id", async () => {
	resetFixtureRoot();

	const filePath = writeJsonlFixture(
		fixtureRoot,
		join("projects", MANGLED_PROJECT, "cn-session-one.jsonl"),
		[
			claudeLine({
				uuid: "u1",
				type: "user",
				content: "把解析器里的脏数据过滤掉",
				cwd: CWD,
				timestamp: "2026-08-01T09:00:01.000Z",
			}),
			claudeLine({
				uuid: "a1",
				parentUuid: "u1",
				type: "assistant",
				content: "我先读一下读取器。",
				cwd: CWD,
				timestamp: "2026-08-01T09:00:02.000Z",
			}),
			{ type: "ai-title", aiTitle: "过滤脏数据", sessionId: "cn-session-one" },
		],
	);

	const info = await qoderCnAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "qoder-cn");
	assert.equal(info.displayName, "Qoder CN");
	assert.equal(info.dataDir, fixtureRoot);
	assert.equal(info.conversationCount, 1);

	const metas = await qoderCnAdapter.scan();
	assert.equal(metas.length, 1);
	const meta = metas[0];
	assert.ok(meta);
	assert.equal(meta.id, "cn-session-one");
	assert.equal(meta.source, "qoder-cn");
	assert.equal(meta.filePath, filePath);
	assert.equal(meta.projectDir, MANGLED_PROJECT);
	assert.equal(meta.rootDir, fixtureRoot);

	const parsed = await qoderCnAdapter.parse(meta);
	assert.equal(parsed.id, "cn-session-one");
	assert.equal(parsed.source, "qoder-cn");
	assert.equal(parsed.slug, "过滤脏数据");
	assert.equal(parsed.cwd, CWD);
	assert.deepEqual(
		parsed.messages.map((message) => [message.type, message.content]),
		[
			["user", "把解析器里的脏数据过滤掉"],
			["assistant", "我先读一下读取器。"],
		],
	);
});

test("tolerates transcripts that contain only corrupt lines", async () => {
	resetFixtureRoot();
	writeJsonlFixture(
		fixtureRoot,
		join("projects", "-tmp-broken-cn", "broken-session.jsonl"),
		["not json", '{"partial":'],
	);

	const metas = await qoderCnAdapter.scan();
	assert.equal(metas.length, 1);
	const meta = metas[0];
	assert.ok(meta);
	assert.equal(meta.id, "broken-session");
	const parsed = await qoderCnAdapter.parse(meta);
	assert.equal(parsed.source, "qoder-cn");
	assert.deepEqual(parsed.messages, []);
	assert.equal(parsed.slug, null);
});

test("scans a WSL distro home as an extra root", async () => {
	resetFixtureRoot();
	writeJsonlFixture(
		wslRoot,
		join("projects", "-home-wsl-cn-app", "wsl-cn-session.jsonl"),
		[
			claudeLine({
				uuid: "w1",
				type: "user",
				content: "wsl cn question",
				cwd: "/home/wsl/cn-app",
				timestamp: "2026-08-04T10:00:01.000Z",
			}),
		],
	);

	setWslHomesForTesting([wslHome]);
	try {
		const info = await qoderCnAdapter.detect();
		assert.ok(info);
		assert.equal(info.conversationCount, 1);
		const metas = await qoderCnAdapter.scan();
		assert.equal(metas.length, 1);
		assert.equal(metas[0]?.id, "wsl-cn-session");
		assert.equal(metas[0]?.rootDir, wslRoot);
		const parsed = await qoderCnAdapter.parse(metas[0]!);
		assert.equal(parsed.cwd, "/home/wsl/cn-app");
		assert.equal(parsed.messages[0]?.content, "wsl cn question");
	} finally {
		setWslHomesForTesting(null);
	}
});

test("watchPaths points at the local projects tree", () => {
	resetFixtureRoot();
	const paths = qoderCnAdapter.watchPaths?.() ?? [];
	assert.equal(paths.length, 1);
	assert.ok(paths[0]?.includes("projects"));
});
