import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import type { ParsePoolMeta } from "./parse-pool.js";

const fixtureRoot = mkdtempSync(join(tmpdir(), "cc-parse-pool-"));
const projectsDir = join(fixtureRoot, "projects");

// appConfig freezes when config.ts is first imported, so point the fixture at
// this test's directory before importing the pool (which imports the parser
// registry and through it every adapter's config module).
process.env.CLAUDE_PROJECTS_DIR = projectsDir;
process.env.CHATCRYSTAL_WSL = "0";
process.env.CHATCRYSTAL_PARSE_WORKERS = "";

const { createParsePool } = await import("./parse-pool.js");

after(() => {
	process.env.CHATCRYSTAL_PARSE_WORKERS = "";
	rmSync(fixtureRoot, { recursive: true, force: true });
});

function setWorkerCount(value: string): void {
	process.env.CHATCRYSTAL_PARSE_WORKERS = value;
}

/** Write a two-message Claude Code JSONL session and return its metadata. */
function createSession(sessionId: string): ParsePoolMeta {
	const projectDir = join(projectsDir, "C--work-app");
	mkdirSync(projectDir, { recursive: true });
	const filePath = join(projectDir, `${sessionId}.jsonl`);
	const cwd = "C:\\work\\app";
	const lines = [
		{
			uuid: `${sessionId}-u`,
			parentUuid: null,
			type: "user",
			sessionId,
			cwd,
			timestamp: "2026-11-10T10:00:00.000Z",
			message: { role: "user", content: `question ${sessionId}` },
		},
		{
			uuid: `${sessionId}-a`,
			parentUuid: `${sessionId}-u`,
			type: "assistant",
			sessionId,
			cwd,
			timestamp: "2026-11-10T10:00:01.000Z",
			message: {
				role: "assistant",
				content: [{ type: "text", text: `reply ${sessionId}` }],
			},
		},
	];
	writeFileSync(
		filePath,
		`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
		"utf-8",
	);
	const fileStat = statSync(filePath);
	return {
		id: sessionId,
		source: "claude-code",
		filePath,
		fileSize: fileStat.size,
		fileMtime: fileStat.mtime.toISOString(),
		projectDir: "C--work-app",
		rootDir: projectsDir,
		adapterName: "claude-code",
	};
}

interface CapturedWarnings {
	warnings: string[];
	restore(): void;
}

/** Collect console.warn() output, used to assert the one-time fallback warn. */
function captureWarnings(): CapturedWarnings {
	const warnings: string[] = [];
	const original = console.warn;
	console.warn = (...args: unknown[]) => {
		warnings.push(args.map((value) => String(value)).join(" "));
	};
	return {
		warnings,
		restore: () => {
			console.warn = original;
		},
	};
}

function poolWarnings(captured: CapturedWarnings): string[] {
	return captured.warnings.filter((line) => line.includes("[ParsePool]"));
}

test("size follows the default CPU formula, the env var and the explicit option", async () => {
	setWorkerCount("");
	const defaultPool = createParsePool();
	try {
		const expected = Math.min(
			4,
			Math.max(1, availableParallelism() - 1),
		);
		assert.equal(defaultPool.size, expected);
	} finally {
		await defaultPool.close();
	}

	// An unparsable value means "use the default", not a broken pool.
	setWorkerCount("not-a-number");
	const invalidEnvPool = createParsePool();
	try {
		assert.ok(invalidEnvPool.size >= 1 && invalidEnvPool.size <= 4);
	} finally {
		await invalidEnvPool.close();
	}

	setWorkerCount("3");
	const envPool = createParsePool();
	try {
		assert.equal(envPool.size, 3);
	} finally {
		await envPool.close();
	}

	// An explicit size is a caller decision and wins over the env var.
	const explicitPool = createParsePool({ size: 1 });
	try {
		assert.equal(explicitPool.size, 1);
	} finally {
		await explicitPool.close();
	}

	setWorkerCount("0");
	const disabledPool = createParsePool();
	try {
		assert.equal(disabledPool.size, 0);
	} finally {
		await disabledPool.close();
	}

	setWorkerCount("");
});

test("parses several conversations through worker threads", async (t) => {
	setWorkerCount("2");
	const pool = createParsePool();
	const captured = captureWarnings();
	t.after(async () => {
		await pool.close();
		captured.restore();
	});

	const sessionIds = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];
	const metas = sessionIds.map((name) => createSession(`parallel-${name}`));
	assert.ok(pool.size >= 1);

	// All six run at once; the pool queues them over its two workers.
	const parsed = await Promise.all(metas.map((meta) => pool.parse(meta)));

	assert.equal(parsed.length, metas.length);
	for (const [index, conversation] of parsed.entries()) {
		const sessionId = `parallel-${sessionIds[index]}`;
		assert.equal(conversation.id, sessionId);
		assert.equal(conversation.source, "claude-code");
		assert.equal(conversation.messages.length, 2);
		assert.equal(conversation.messages[0]?.type, "user");
		assert.equal(conversation.messages[0]?.content, `question ${sessionId}`);
		assert.equal(conversation.messages[1]?.type, "assistant");
		assert.equal(conversation.messages[1]?.content, `reply ${sessionId}`);
	}
	// A successful worker parse must not warn about falling back inline.
	assert.equal(poolWarnings(captured).length, 0);

	// Later parses reuse the same workers.
	const reused = await pool.parse(createSession("parallel-reuse"));
	assert.equal(reused.id, "parallel-reuse");
	assert.equal(reused.messages.length, 2);
	assert.equal(poolWarnings(captured).length, 0);
});

test("propagates adapter parse errors and keeps the pool usable", async (t) => {
	setWorkerCount("2");
	const pool = createParsePool();
	const captured = captureWarnings();
	t.after(async () => {
		await pool.close();
		captured.restore();
	});

	const missingFile = join(projectsDir, "C--work-app", "missing.jsonl");
	const brokenMeta: ParsePoolMeta = {
		id: "missing",
		source: "claude-code",
		filePath: missingFile,
		fileSize: 0,
		fileMtime: new Date().toISOString(),
		projectDir: "C--work-app",
		adapterName: "claude-code",
	};
	await assert.rejects(pool.parse(brokenMeta), /ENOENT|no such file/i);

	// A single broken conversation is a per-task error, not a pool failure.
	const ok = await pool.parse(createSession("after-error"));
	assert.equal(ok.id, "after-error");
	assert.equal(ok.messages.length, 2);
	assert.equal(poolWarnings(captured).length, 0);
});

test("rejects unknown adapter names", async (t) => {
	setWorkerCount("2");
	const pool = createParsePool();
	t.after(() => pool.close());

	const meta: ParsePoolMeta = {
		...createSession("unknown-adapter"),
		adapterName: "not-a-real-adapter",
	};
	await assert.rejects(
		pool.parse(meta),
		/Unknown parser adapter: not-a-real-adapter/,
	);
});

test("falls back to inline parsing once when workers cannot start", async (t) => {
	setWorkerCount("2");
	const captured = captureWarnings();
	const pool = createParsePool({
		workerPath: join(fixtureRoot, "no-such-worker.js"),
		startupTimeoutMs: 3_000,
	});
	t.after(async () => {
		await pool.close();
		captured.restore();
	});

	const first = await pool.parse(createSession("fallback-one"));
	const second = await pool.parse(createSession("fallback-two"));
	assert.equal(first.id, "fallback-one");
	assert.equal(first.messages.length, 2);
	assert.equal(second.id, "fallback-two");
	assert.equal(second.messages.length, 2);

	const fallback = poolWarnings(captured).filter((line) =>
		line.includes("falling back"),
	);
	assert.equal(fallback.length, 1);
});

test("parses inline without workers when disabled", async (t) => {
	setWorkerCount("0");
	const captured = captureWarnings();
	const envPool = createParsePool();
	const forcedPool = createParsePool({ forceInline: true, size: 2 });
	t.after(async () => {
		await envPool.close();
		await forcedPool.close();
		captured.restore();
	});

	assert.equal(envPool.size, 0);
	assert.equal(forcedPool.size, 2);
	for (const pool of [envPool, forcedPool]) {
		const parsed = await pool.parse(createSession("inline-mode"));
		assert.equal(parsed.id, "inline-mode");
		assert.equal(parsed.messages.length, 2);
	}
	// Inline mode is explicit here, so it should not warn about workers.
	assert.equal(poolWarnings(captured).length, 0);
});

test("close is idempotent and rejects parses afterwards", async () => {
	setWorkerCount("2");
	const pool = createParsePool();
	const meta = createSession("close-once");
	try {
		const parsed = await pool.parse(meta);
		assert.equal(parsed.id, "close-once");

		// Close can be called concurrently and repeatedly.
		await Promise.all([pool.close(), pool.close()]);
		await pool.close();

		await assert.rejects(pool.parse(meta), /Parser pool is closed/);
	} finally {
		await pool.close();
	}
});
