import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { gzipSync } from "node:zlib";
import type {
	ConversationMeta,
	ParsedConversation,
} from "@chatcrystal/shared";

// appConfig freezes on first import, so the cache root must point at this
// test's temp DATA_DIR *before* importing the module. The cache itself reads
// its env overrides at call time, so individual tests can retune them.
const dataDir = mkdtempSync(
	join(tmpdir(), "chatcrystal-transcript-cache-test-"),
);
const cacheDir = join(dataDir, "transcript-cache");

process.env.DATA_DIR = dataDir;
process.env.CHATCRYSTAL_TRANSCRIPT_CACHE = "";
process.env.CHATCRYSTAL_TRANSCRIPT_CACHE_DIR = "";
process.env.CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_MB = "";
process.env.CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_AGE_DAYS = "";

const {
	clearTranscriptCache,
	getTranscriptCacheStats,
	pruneTranscriptCache,
	readTranscriptCache,
	writeTranscriptCache,
} = await import("./transcript-cache.js");

type CacheMeta = Pick<
	ConversationMeta,
	"id" | "source" | "filePath" | "fileSize" | "fileMtime" | "rootDir"
>;

const CACHE_ENV_KEYS = [
	"CHATCRYSTAL_TRANSCRIPT_CACHE",
	"CHATCRYSTAL_TRANSCRIPT_CACHE_DIR",
	"CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_MB",
	"CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_AGE_DAYS",
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** 0.05 MiB, the tiny size cap the prune tests set through the env var. */
const SMALL_SIZE_CAP_BYTES = 0.05 * 1024 * 1024;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetCacheEnv(): void {
	for (const key of CACHE_ENV_KEYS) process.env[key] = "";
}

beforeEach(async () => {
	resetCacheEnv();
	// Drop the previous test's entries and drain any background prune it
	// started, so counters and folder content start from zero.
	clearTranscriptCache();
	await pruneTranscriptCache();
	clearTranscriptCache();
});

after(() => {
	resetCacheEnv();
	clearTranscriptCache();
	rmSync(dataDir, { recursive: true, force: true });
});

function buildMeta(overrides: Partial<CacheMeta> = {}): CacheMeta {
	return {
		id: "conv-1",
		source: "claude-code",
		filePath: "C:\\work\\app\\session.jsonl",
		fileSize: 12_345,
		fileMtime: "2026-11-10T10:00:00.000Z",
		rootDir: undefined,
		...overrides,
	};
}

type ParsedMessage = ParsedConversation["messages"][number];

function makeMessage(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
	return {
		id: "msg-1",
		parentUuid: null,
		type: "user",
		role: "user",
		content: "",
		hasToolUse: false,
		hasCode: false,
		thinking: null,
		timestamp: "2026-11-10T10:00:01.000Z",
		...overrides,
	};
}

function buildParsed(
	overrides: Partial<ParsedConversation> = {},
): ParsedConversation {
	return {
		id: "conv-1",
		slug: "缓存重构测试",
		source: "claude-code",
		projectDir: "C:\\work\\app",
		projectName: "app",
		cwd: "C:\\work\\app",
		gitBranch: "main",
		messages: [
			makeMessage({
				id: "msg-1",
				content: "请重构这个模块：\n```ts\nexport const 值 = 1;\n```",
				hasCode: true,
			}),
			makeMessage({
				id: "msg-2",
				parentUuid: "msg-1",
				type: "assistant",
				role: "assistant",
				content: "好的，先看一下调用方。",
				hasToolUse: true,
				thinking: "先找引用…",
				timestamp: "2026-11-10T10:00:02.000Z",
			}),
		],
		firstMessageAt: "2026-11-10T10:00:01.000Z",
		lastMessageAt: "2026-11-10T10:00:02.000Z",
		...overrides,
	};
}

/** A parsed conversation with a large user message, for size-related tests. */
function parsedWithUserContent(
	id: string,
	userContent: string,
): ParsedConversation {
	return buildParsed({
		id,
		messages: [
			makeMessage({ id: "msg-1", content: userContent }),
			makeMessage({
				id: "msg-2",
				parentUuid: "msg-1",
				type: "assistant",
				role: "assistant",
				content: "ok",
				hasToolUse: true,
				thinking: "想",
				timestamp: "2026-11-10T10:00:02.000Z",
			}),
		],
	});
}

/** The exact path the contract's SHA-1 key and <source>/<sha1> layout imply. */
function expectedCachePath(
	meta: CacheMeta,
	parserVersion: string,
	baseDir = cacheDir,
): string {
	const hash = createHash("sha1")
		.update(
			[
				meta.source,
				meta.id,
				parserVersion,
				meta.filePath,
				String(meta.fileSize),
				meta.fileMtime,
				meta.rootDir ?? "",
			].join("\0"),
		)
		.digest("hex");
	return join(baseDir, meta.source, `${hash}.json.gz`);
}

/** ~12 KiB of poorly compressible base64, so each entry has a real size. */
function bulkyContent(kilobytes = 12): string {
	return randomBytes(kilobytes * 1024).toString("base64");
}

test("write then read round-trips a parsed conversation at <source>/<sha1>.json.gz", async () => {
	const meta = buildMeta();
	const parsed = buildParsed();

	await writeTranscriptCache(meta, "claude-code@2", parsed);

	const filePath = expectedCachePath(meta, "claude-code@2");
	assert.equal(existsSync(filePath), true);
	assert.match(
		filePath,
		/[\\/]claude-code[\\/][0-9a-f]{40}\.json\.gz$/,
	);
	// The write is atomic: no temp file is left behind.
	assert.deepEqual(
		readdirSync(join(cacheDir, "claude-code")).filter((name) =>
			name.endsWith(".tmp"),
		),
		[],
	);

	const cached = await readTranscriptCache(meta, "claude-code@2");
	assert.deepEqual(cached, parsed);
	// Chinese text, tool-use flags, code fences and thinking survive the trip.
	assert.equal(cached?.slug, "缓存重构测试");
	assert.equal(cached?.messages[0]?.hasCode, true);
	assert.equal(cached?.messages[1]?.hasToolUse, true);
	assert.equal(cached?.messages[1]?.thinking, "先找引用…");

	const stats = await getTranscriptCacheStats();
	assert.equal(stats.files, 1);
	assert.equal(stats.bytes, statSync(filePath).size);
	assert.ok(stats.bytes > 0);
});

test("gzip keeps entries much smaller than their JSON payload", async () => {
	const meta = buildMeta();
	const parsed = buildParsed({
		messages: [
			makeMessage({
				content: "被测内容与思考过程。\n".repeat(2_000),
			}),
			makeMessage({ id: "msg-2" }),
		],
	});
	await writeTranscriptCache(meta, "claude-code@2", parsed);

	const filePath = expectedCachePath(meta, "claude-code@2");
	const jsonBytes = Buffer.byteLength(JSON.stringify(parsed), "utf-8");
	const gzipBytes = statSync(filePath).size;
	assert.ok(
		gzipBytes < jsonBytes / 4,
		`gzip ${gzipBytes}B should be well under JSON ${jsonBytes}B`,
	);
});

test("size, mtime, file path, rootDir and parser version changes all miss", async () => {
	const meta = buildMeta();
	await writeTranscriptCache(meta, "claude-code@2", buildParsed());
	assert.ok(await readTranscriptCache(meta, "claude-code@2"));

	const changedMeta: Array<[string, CacheMeta]> = [
		["fileSize", { ...meta, fileSize: meta.fileSize + 1 }],
		["fileMtime", { ...meta, fileMtime: "2026-11-11T00:00:00.000Z" }],
		["filePath", { ...meta, filePath: "C:\\work\\app\\other.jsonl" }],
		[
			"rootDir",
			{
				...meta,
				rootDir:
					"\\\\wsl.localhost\\Ubuntu\\home\\me\\.claude\\projects",
			},
		],
	];
	for (const [label, changed] of changedMeta) {
		assert.equal(
			await readTranscriptCache(changed, "claude-code@2"),
			null,
			`a changed ${label} must miss`,
		);
	}
	assert.equal(
		await readTranscriptCache(meta, "claude-code@3"),
		null,
		"a changed parserVersion must miss",
	);
	// The unchanged identity still hits.
	assert.ok(await readTranscriptCache(meta, "claude-code@2"));
});

test("CHATCRYSTAL_TRANSCRIPT_CACHE=off|0|false disables reads and writes", async () => {
	const meta = buildMeta();
	for (const value of ["off", "0", "false", "OFF", "False"]) {
		process.env.CHATCRYSTAL_TRANSCRIPT_CACHE = value;
		await writeTranscriptCache(meta, "claude-code@2", buildParsed());
		assert.equal(await readTranscriptCache(meta, "claude-code@2"), null);
		assert.deepEqual(await getTranscriptCacheStats(), {
			files: 0,
			bytes: 0,
		});
	}

	process.env.CHATCRYSTAL_TRANSCRIPT_CACHE = "";
	await writeTranscriptCache(meta, "claude-code@2", buildParsed());
	assert.ok(await readTranscriptCache(meta, "claude-code@2"));
});

/** Collect console.warn output so expected warnings stay out of test logs. */
function captureWarnings(): { warnings: string[]; restore(): void } {
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

test("corrupt, truncated and malformed entries are misses, never throws", async () => {
	const captured = captureWarnings();
	try {
		const meta = buildMeta();
		await writeTranscriptCache(meta, "claude-code@2", buildParsed());
		const filePath = expectedCachePath(meta, "claude-code@2");
		const valid = readFileSync(filePath);

		// Not gzip at all.
		writeFileSync(filePath, "this is not gzip");
		assert.equal(await readTranscriptCache(meta, "claude-code@2"), null);

		// Truncated gzip.
		writeFileSync(
			filePath,
			valid.subarray(0, Math.floor(valid.length / 2)),
		);
		assert.equal(await readTranscriptCache(meta, "claude-code@2"), null);

		// Valid gzip, invalid JSON.
		writeFileSync(filePath, gzipSync(Buffer.from("{not json", "utf-8")));
		assert.equal(await readTranscriptCache(meta, "claude-code@2"), null);

		// Valid JSON but not a cache envelope.
		writeFileSync(
			filePath,
			gzipSync(
				Buffer.from(
					JSON.stringify({ version: 1, parsed: { id: "only-an-id" } }),
					"utf-8",
				),
			),
		);
		assert.equal(await readTranscriptCache(meta, "claude-code@2"), null);

		// Missing file.
		rmSync(filePath);
		assert.equal(await readTranscriptCache(meta, "claude-code@2"), null);

		// Unreadable entries warn once, not once per file.
		assert.equal(
			captured.warnings.filter((line) => line.includes("[TranscriptCache]"))
				.length,
			1,
		);
	} finally {
		captured.restore();
	}
});

test("unwritable cache locations are quiet misses", async () => {
	const captured = captureWarnings();
	try {
		const blockedPath = join(dataDir, "blocked-cache");
		writeFileSync(blockedPath, "not a directory", "utf-8");
		process.env.CHATCRYSTAL_TRANSCRIPT_CACHE_DIR = blockedPath;

		const meta = buildMeta();
		await assert.doesNotReject(
			writeTranscriptCache(meta, "claude-code@2", buildParsed()),
		);
		assert.equal(await readTranscriptCache(meta, "claude-code@2"), null);
		assert.deepEqual(await getTranscriptCacheStats(), {
			files: 0,
			bytes: 0,
		});
		assert.equal(
			captured.warnings.filter((line) => line.includes("[TranscriptCache]"))
				.length,
			1,
		);
	} finally {
		captured.restore();
	}
});

test("CHATCRYSTAL_TRANSCRIPT_CACHE_DIR overrides the cache folder", async () => {
	const overrideDir = join(dataDir, "custom-cache");
	process.env.CHATCRYSTAL_TRANSCRIPT_CACHE_DIR = overrideDir;

	const meta = buildMeta();
	await writeTranscriptCache(meta, "claude-code@2", buildParsed());
	assert.equal(
		existsSync(expectedCachePath(meta, "claude-code@2", overrideDir)),
		true,
	);
	assert.equal(existsSync(cacheDir), false);
	assert.ok(await readTranscriptCache(meta, "claude-code@2"));
});

test("stats count entries and clear removes the whole cache folder", async () => {
	const first = buildMeta({ id: "conv-1" });
	const second = buildMeta({ id: "conv-2" });
	const otherSource = buildMeta({
		id: "conv-1",
		source: "dsh",
		filePath: "/home/me/.dsh/sessions/s.jsonl",
		fileSize: 512,
		fileMtime: "2026-11-09T09:00:00.000Z",
	});
	await writeTranscriptCache(first, "claude-code@2", buildParsed({ id: "conv-1" }));
	await writeTranscriptCache(
		second,
		"claude-code@2",
		buildParsed({ id: "conv-2" }),
	);
	await writeTranscriptCache(
		otherSource,
		"dsh@1",
		buildParsed({ id: "conv-1", source: "dsh" }),
	);

	assert.equal(existsSync(join(cacheDir, "dsh")), true);
	const stats = await getTranscriptCacheStats();
	assert.equal(stats.files, 3);
	const expectedBytes =
		statSync(expectedCachePath(first, "claude-code@2")).size +
		statSync(expectedCachePath(second, "claude-code@2")).size +
		statSync(expectedCachePath(otherSource, "dsh@1")).size;
	assert.equal(stats.bytes, expectedBytes);

	clearTranscriptCache();
	assert.equal(existsSync(cacheDir), false);
	assert.deepEqual(await getTranscriptCacheStats(), { files: 0, bytes: 0 });
	assert.equal(await readTranscriptCache(first, "claude-code@2"), null);
	// Clearing a missing folder is a no-op, not a crash.
	assert.doesNotThrow(() => clearTranscriptCache());
});

test("prune enforces the size cap, deleting the oldest entries first", async () => {
	// Write under the generous default cap, then tighten it and prune on demand.
	const metas: CacheMeta[] = [];
	for (let index = 0; index < 6; index++) {
		const meta = buildMeta({
			id: `prune-${index}`,
			filePath: `C:\\work\\app\\prune-${index}.jsonl`,
		});
		metas.push(meta);
		await writeTranscriptCache(
			meta,
			"claude-code@2",
			parsedWithUserContent(`prune-${index}`, bulkyContent()),
		);
	}
	const before = await getTranscriptCacheStats();
	assert.equal(before.files, 6);
	assert.ok(before.bytes > 0);

	// Give every entry a distinct, explicit write time so "oldest first" is
	// deterministic rather than dependent on filesystem mtime resolution.
	const now = Date.now();
	for (const [index, meta] of metas.entries()) {
		const written = new Date(now - (metas.length - index) * 60_000);
		utimesSync(
			expectedCachePath(meta, "claude-code@2"),
			written,
			written,
		);
	}

	process.env.CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_MB = "0.05";
	process.env.CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_AGE_DAYS = "30";
	await pruneTranscriptCache();

	const after = await getTranscriptCacheStats();
	assert.ok(
		after.bytes <= SMALL_SIZE_CAP_BYTES,
		`cache bytes ${after.bytes} should be inside the small size cap`,
	);
	assert.ok(after.files < before.files);
	assert.ok(after.files >= 1);

	// The newest entry survives (oldest-first deletion).
	assert.ok(await readTranscriptCache(metas[5]!, "claude-code@2"));
});

test("prune drops entries older than the age limit", async () => {
	process.env.CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_AGE_DAYS = "1";
	const metas = [0, 1, 2].map((index) =>
		buildMeta({
			id: `age-${index}`,
			filePath: `C:\\work\\app\\age-${index}.jsonl`,
		}),
	);
	for (const [index, meta] of metas.entries()) {
		await writeTranscriptCache(
			meta,
			"claude-code@2",
			buildParsed({ id: `age-${index}` }),
		);
	}

	const old = new Date(Date.now() - 3 * MS_PER_DAY);
	utimesSync(expectedCachePath(metas[0]!, "claude-code@2"), old, old);
	utimesSync(expectedCachePath(metas[1]!, "claude-code@2"), old, old);

	await pruneTranscriptCache();
	const stats = await getTranscriptCacheStats();
	assert.equal(stats.files, 1);
	assert.ok(await readTranscriptCache(metas[2]!, "claude-code@2"));
});

test("writes trigger a background prune once the size estimate passes the cap", async () => {
	process.env.CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_MB = "0.05";
	process.env.CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_AGE_DAYS = "30";

	for (let index = 0; index < 5; index++) {
		const id = `auto-${index}`;
		await writeTranscriptCache(
			buildMeta({ id, filePath: `C:\\work\\app\\${id}.jsonl` }),
			"claude-code@2",
			parsedWithUserContent(id, bulkyContent()),
		);
	}

	// The writes passed the cap, so pruning happens without an explicit call.
	const deadline = Date.now() + 5_000;
	let stats = await getTranscriptCacheStats();
	while (stats.bytes > SMALL_SIZE_CAP_BYTES && Date.now() < deadline) {
		await sleep(25);
		stats = await getTranscriptCacheStats();
	}
	assert.ok(
		stats.bytes <= SMALL_SIZE_CAP_BYTES,
		`background prune should cap bytes, got ${stats.bytes}`,
	);
	assert.ok(stats.files >= 1);
});
