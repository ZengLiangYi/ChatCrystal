import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ImportOptions, ImportProgress } from "./import.js";
import {
	SyncEngine,
	scheduleStartupSync,
	type SyncImportAll,
	type SyncManager,
	type SyncStatus,
} from "./sync.js";
import {
	collectWatchTargets,
	isWslUncPath,
	mapPathsToSources,
	type WatchBinding,
} from "../watcher/index.js";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
	predicate: () => boolean,
	label: string,
	timeoutMs = 2000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error(`timed out waiting for ${label}`);
		}
		await sleep(5);
	}
}

function emptyProgress(
	overrides: Partial<ImportProgress> = {},
): ImportProgress {
	return {
		total: 0,
		current: 0,
		currentFile: "",
		phase: "done",
		sources: [],
		errorsDetail: [],
		durationMs: 7,
		cancelled: false,
		imported: 0,
		replaced: 0,
		skipped: 0,
		errors: 0,
		importedIds: [],
		replacedIds: [],
		skippedIds: [],
		errorIds: [],
		summarizationCandidateIds: [],
		...overrides,
	};
}

interface FakeCall {
	options: ImportOptions;
}

/**
 * A controllable `importAll`: every call parks until the test resolves it (or
 * the passed AbortSignal fires, which rejects with an AbortError the way a real
 * aborted import settles).
 */
function createFakeImportAll() {
	const calls: FakeCall[] = [];
	const pending: {
		resolve: (progress: ImportProgress) => void;
		reject: (error: unknown) => void;
	}[] = [];

	const importAllFn: SyncImportAll = (options) => {
		const optionsCopy: ImportOptions = options ?? {};
		calls.push({ options: optionsCopy });
		return new Promise<ImportProgress>((resolve, reject) => {
			pending.push({ resolve, reject });
			optionsCopy.signal?.addEventListener(
				"abort",
				() => {
					const error = new Error("The operation was aborted");
					error.name = "AbortError";
					reject(error);
				},
				{ once: true },
			);
		});
	};

	return {
		importAllFn,
		calls,
		resolveCall(index: number, progress: ImportProgress): void {
			const call = pending[index];
			assert.ok(call, `expected import call ${index}`);
			call.resolve(progress);
		},
		rejectCall(index: number, error: unknown): void {
			const call = pending[index];
			assert.ok(call, `expected import call ${index}`);
			call.reject(error);
		},
	};
}

function createManager() {
	const fake = createFakeImportAll();
	const manager = new SyncEngine(fake.importAllFn);
	return { manager, fake };
}

// =============================================
// Sync state machine
// =============================================

test("status starts idle with auto-sync enabled", () => {
	const { manager } = createManager();
	assert.deepEqual(manager.getStatus(), {
		phase: "idle",
		autoSyncEnabled: true,
	});
});

test("start runs a pass, streams progress and records the last result", async () => {
	const { manager, fake } = createManager();
	const seen: SyncStatus[] = [];
	const unsubscribe = manager.subscribe((status) => seen.push(status));

	assert.equal(manager.start("manual"), true);

	const running = manager.getStatus();
	assert.equal(running.phase, "syncing");
	assert.equal(typeof running.startedAt, "number");
	assert.equal(running.error, undefined);

	assert.equal(fake.calls.length, 1);
	const options = fake.calls[0]?.options;
	assert.ok(options);
	assert.equal(options.sources, undefined);
	assert.ok(options.signal instanceof AbortSignal);
	assert.equal(typeof options.onProgress, "function");

	options.onProgress?.(
		emptyProgress({
			phase: "importing",
			total: 3,
			current: 1,
			sources: [
				{
					source: "codex",
					displayName: "Codex",
					status: "importing",
					found: 3,
					processed: 1,
					imported: 1,
					replaced: 0,
					skipped: 0,
					errors: 0,
				},
			],
		}),
	);
	assert.equal(manager.getStatus().progress?.phase, "importing");
	assert.equal(manager.getStatus().progress?.current, 1);

	fake.resolveCall(
		0,
		emptyProgress({
			phase: "done",
			total: 3,
			imported: 2,
			skipped: 1,
			durationMs: 123,
		}),
	);
	await waitFor(() => manager.getStatus().phase === "idle", "done phase");

	const finished = manager.getStatus();
	assert.equal(finished.finishedAt !== undefined, true);
	assert.equal(typeof finished.lastCompletedAt, "number");
	assert.deepEqual(finished.lastResult, {
		total: 3,
		imported: 2,
		replaced: 0,
		skipped: 1,
		errors: 0,
		durationMs: 123,
	});
	// The final progress tree is kept after the pass instead of being cleared.
	assert.equal(finished.progress?.phase, "done");
	assert.equal(finished.error, undefined);

	assert.ok(seen.some((status) => status.phase === "syncing"));
	assert.ok(seen.some((status) => status.phase === "idle"));
	unsubscribe();
});

test("triggers during a pass are merged into one follow-up pass", async () => {
	const { manager, fake } = createManager();

	assert.equal(manager.start("manual"), true);
	// A second manual trigger and a watcher burst both arrive mid-pass.
	assert.equal(manager.start("api", ["codex"]), false);
	manager.requestSources(["gemini"]);

	fake.resolveCall(0, emptyProgress({ phase: "done", imported: 1 }));
	await waitFor(() => fake.calls.length === 2, "merged follow-up pass");

	// One pass for the merged union, not one pass per trigger.
	assert.deepEqual(fake.calls[1]?.options.sources, ["codex", "gemini"]);

	fake.resolveCall(1, emptyProgress({ phase: "done", imported: 1 }));
	await waitFor(() => manager.getStatus().phase === "idle", "merged pass done");
	assert.equal(fake.calls.length, 2);
});

test("a full-sync trigger during a pass wins over source-specific ones", async () => {
	const { manager, fake } = createManager();

	assert.equal(manager.start("manual", ["codex"]), true);
	assert.equal(manager.start("api"), false);

	fake.resolveCall(0, emptyProgress());
	await waitFor(() => fake.calls.length === 2, "pending full pass");
	// Pending "all sources" wins: no restriction is passed to importAll.
	assert.equal(fake.calls[1]?.options.sources, undefined);

	fake.resolveCall(1, emptyProgress());
	await waitFor(() => manager.getStatus().phase === "idle", "second pass done");
});

test("cancel aborts the running pass, drops pending work and reports cancelled", async () => {
	const { manager, fake } = createManager();

	assert.equal(manager.cancel(), false);
	assert.equal(manager.start("manual"), true);
	// Queue a follow-up that cancel() must discard.
	assert.equal(manager.start("api", ["codex"]), false);

	const signal = fake.calls[0]?.options.signal;
	assert.ok(signal);
	assert.equal(manager.cancel(), true);
	assert.equal(signal.aborted, true);
	assert.equal(manager.cancel(), false);

	await waitFor(
		() => manager.getStatus().phase === "cancelled",
		"cancelled phase",
	);
	const status = manager.getStatus();
	assert.equal(typeof status.lastCompletedAt, "number");
	assert.equal(status.error, undefined);
	// Aborting settles as an AbortError without a progress tree; a real
	// importAll that reports cancelled progress is covered separately above.
	// The queued follow-up was dropped.
	await sleep(30);
	assert.equal(fake.calls.length, 1);
});

test("an importAll that reports cancelled also lands in the cancelled phase", async () => {
	const { manager, fake } = createManager();
	assert.equal(manager.start("manual"), true);
	fake.resolveCall(
		0,
		emptyProgress({ phase: "cancelled", cancelled: true, total: 5 }),
	);
	await waitFor(
		() => manager.getStatus().phase === "cancelled",
		"cancelled progress",
	);
	const status = manager.getStatus();
	assert.equal(status.progress?.cancelled, true);
	assert.equal(status.lastResult?.total, 5);
});

test("a failing pass lands in the error phase and can be retried", async () => {
	const { manager, fake } = createManager();

	assert.equal(manager.start("manual"), true);
	fake.rejectCall(0, new Error("disk gone"));
	await waitFor(() => manager.getStatus().phase === "error", "error phase");
	assert.equal(manager.getStatus().error, "disk gone");

	// A retry clears the previous error and starts a fresh pass.
	assert.equal(manager.start("manual"), true);
	assert.equal(manager.getStatus().phase, "syncing");
	assert.equal(manager.getStatus().error, undefined);
	fake.resolveCall(
		1,
		emptyProgress({ phase: "done", imported: 4, durationMs: 20 }),
	);
	await waitFor(() => manager.getStatus().phase === "idle", "retry done");
	assert.equal(manager.getStatus().lastResult?.imported, 4);
});

test("requestSources starts a targeted pass but respects auto-sync", async () => {
	const { manager, fake } = createManager();

	manager.setAutoSyncEnabled(false);
	assert.equal(manager.getStatus().autoSyncEnabled, false);
	manager.requestSources(["claude-code"]);
	await sleep(20);
	assert.equal(fake.calls.length, 0);

	manager.setAutoSyncEnabled(true);
	assert.equal(manager.getStatus().autoSyncEnabled, true);
	manager.requestSources(["claude-code"]);
	assert.equal(fake.calls.length, 1);
	assert.deepEqual(fake.calls[0]?.options.sources, ["claude-code"]);

	fake.resolveCall(0, emptyProgress());
	await waitFor(() => manager.getStatus().phase === "idle", "targeted done");
});

test("stop aborts the running pass and blocks new starts", async () => {
	const { manager, fake } = createManager();

	assert.equal(manager.start("manual"), true);
	const signal = fake.calls[0]?.options.signal;
	assert.ok(signal);
	await manager.stop();

	assert.equal(signal.aborted, true);
	assert.equal(manager.start("manual"), false);
	await waitFor(
		() => manager.getStatus().phase === "cancelled",
		"cancelled after stop",
	);
});

test("unsubscribe stops status notifications", async () => {
	const { manager, fake } = createManager();
	const statuses: SyncStatus[] = [];
	const unsubscribe = manager.subscribe((status) => statuses.push(status));

	unsubscribe();
	manager.setAutoSyncEnabled(false);
	assert.equal(statuses.length, 0);

	assert.equal(manager.start("manual"), true);
	fake.resolveCall(0, emptyProgress());
	await waitFor(() => manager.getStatus().phase === "idle", "done");
	assert.equal(statuses.length, 0);
});

test("scheduleStartupSync starts one startup pass when auto-sync is on", async () => {
	const started: Array<string | undefined> = [];
	const manager: SyncManager = {
		start(reason) {
			started.push(reason);
			return true;
		},
		cancel: () => false,
		getStatus: () => ({ phase: "idle", autoSyncEnabled: true }),
		subscribe: () => () => {},
		setAutoSyncEnabled: () => {},
		stop: async () => {},
		requestSources: () => {},
	};

	const timer = scheduleStartupSync(10, manager);
	await waitFor(() => started.length === 1, "startup pass", 1000);
	assert.deepEqual(started, ["startup"]);
	clearTimeout(timer);
});

test("scheduleStartupSync is a no-op when auto-sync is disabled", async () => {
	let started = 0;
	const manager: SyncManager = {
		start: () => {
			started++;
			return true;
		},
		cancel: () => false,
		getStatus: () => ({ phase: "idle", autoSyncEnabled: false }),
		subscribe: () => () => {},
		setAutoSyncEnabled: () => {},
		stop: async () => {},
		requestSources: () => {},
	};

	const timer = scheduleStartupSync(10, manager);
	await sleep(80);
	assert.equal(started, 0);
	clearTimeout(timer);
});

// =============================================
// Watcher target → source mapping
// =============================================

const watchFixtureRoot = mkdtempSync(join(tmpdir(), "chatcrystal-watch-"));

test.after(() => {
	rmSync(watchFixtureRoot, { recursive: true, force: true });
});

test("isWslUncPath recognizes WSL UNC paths only", () => {
	assert.equal(isWslUncPath("\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\x"), true);
	assert.equal(isWslUncPath("\\\\wsl$\\Ubuntu-24.04\\home\\me\\x"), true);
	assert.equal(isWslUncPath("//wsl.localhost/Ubuntu-24.04/home/me/x"), true);
	assert.equal(isWslUncPath("\\\\server\\share\\dir"), false);
	assert.equal(isWslUncPath("C:\\Users\\me\\.claude\\projects\\x.jsonl"), false);
	assert.equal(isWslUncPath("/home/me/.claude/projects/x.jsonl"), false);
});

test("mapPathsToSources picks the most specific target", () => {
	const claudeRoot = join(watchFixtureRoot, "claude");
	const claudeProjects = join(claudeRoot, "projects");
	const codexRoot = join(watchFixtureRoot, "codex");
	const sharedRoot = join(watchFixtureRoot, "shared");
	mkdirSync(claudeProjects, { recursive: true });
	mkdirSync(codexRoot, { recursive: true });
	mkdirSync(sharedRoot, { recursive: true });

	const bindings: WatchBinding[] = [
		{ target: claudeRoot, sources: ["claude-code"] },
		{ target: claudeProjects, sources: ["claude-code"] },
		{ target: codexRoot, sources: ["codex"] },
		{ target: sharedRoot, sources: ["cline", "continue"] },
	];

	assert.deepEqual(
		mapPathsToSources([join(claudeProjects, "p1", "s1.jsonl")], bindings),
		["claude-code"],
	);
	assert.deepEqual(
		mapPathsToSources([join(codexRoot, "sessions", "s1.jsonl")], bindings),
		["codex"],
	);
	assert.deepEqual(
		mapPathsToSources([join(sharedRoot, "s1.json")], bindings),
		["cline", "continue"],
	);
	assert.deepEqual(
		mapPathsToSources([join(watchFixtureRoot, "elsewhere", "x.jsonl")], bindings),
		[],
	);
	// A WSL path never maps to a local source.
	assert.deepEqual(
		mapPathsToSources(
			["\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\.claude\\projects\\x.jsonl"],
			bindings,
		),
		[],
	);
});

test("collectWatchTargets excludes WSL UNC paths", () => {
	const targets = collectWatchTargets();
	assert.ok(Array.isArray(targets));
	for (const target of targets) {
		assert.equal(
			isWslUncPath(target),
			false,
			`WSL path must not be watched: ${target}`,
		);
	}
});
