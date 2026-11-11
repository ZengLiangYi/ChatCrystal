/**
 * Background incremental sync engine.
 *
 * One import pass at a time: the watcher, the startup pass and the HTTP API all
 * funnel into this state machine. A trigger that arrives while a pass is
 * running is merged into a pending set (sources) or a pending "all sources"
 * flag, and starts the next pass as soon as the current one settles.
 *
 * The manager only reports state; it never touches the database directly. The
 * import work itself is injected through `SyncImportAll`, which defaults to
 * `importAll` from `services/import.ts` and is replaced by a fake in tests.
 *
 * Status phases: `idle` (no pass running; also the phase after a successful
 * pass), `syncing`, `cancelled` and `error`. The last progress object is kept
 * after a pass finishes so an SSE/JSON client can render the final numbers.
 */

import {
	importAll,
	type ImportOptions,
	type ImportProgress,
} from "./import.js";

export type SyncPhase = "idle" | "syncing" | "cancelled" | "error";

/** Small summary of the last completed pass, kept without the big progress tree. */
export interface SyncLastResult {
	total: number;
	imported: number;
	replaced: number;
	skipped: number;
	errors: number;
	durationMs: number;
}

export interface SyncStatus {
	phase: SyncPhase;
	autoSyncEnabled: boolean;
	startedAt?: number;
	finishedAt?: number;
	lastCompletedAt?: number;
	progress?: ImportProgress;
	lastResult?: SyncLastResult;
	error?: string;
}

/** The import entry point, injectable for tests. */
export type SyncImportAll = (options?: ImportOptions) => Promise<ImportProgress>;

export type SyncListener = (status: SyncStatus) => void;

export interface SyncManager {
	/** Start a pass; false when a pass is already running (the request merges). */
	start(reason?: string, sources?: string[]): boolean;
	cancel(): boolean;
	getStatus(): SyncStatus;
	subscribe(listener: SyncListener): () => void;
	setAutoSyncEnabled(enabled: boolean): void;
	stop(): Promise<void>;
	/** Watcher entry point: ignored when auto-sync is off, merged when running. */
	requestSources(sources: string[]): void;
}

const DEFAULT_AUTO_SYNC_ENABLED = true;
const STARTUP_SYNC_DELAY_MS = 2500;

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : "Unknown error";
}

function normalizeSources(sources?: string[]): string[] | undefined {
	if (!sources) return undefined;
	const unique: string[] = [];
	for (const source of sources) {
		if (typeof source !== "string") continue;
		const trimmed = source.trim();
		if (trimmed && !unique.includes(trimmed)) unique.push(trimmed);
	}
	return unique.length > 0 ? unique : undefined;
}

function isAbortError(err: unknown): boolean {
	return err instanceof Error && err.name === "AbortError";
}

/**
 * The sync state machine. Construct one per process (the exported singleton) or
 * per test with an injected import function.
 */
export class SyncEngine implements SyncManager {
	private readonly importAllFn: SyncImportAll;
	private status: SyncStatus;
	private readonly listeners = new Set<SyncListener>();
	private controller: AbortController | null = null;
	private running: Promise<void> | null = null;
	private pendingAll = false;
	private readonly pendingSources = new Set<string>();
	private pendingReason: string | null = null;
	private stopped = false;

	constructor(importAllFn: SyncImportAll = importAll) {
		this.importAllFn = importAllFn;
		this.status = {
			phase: "idle",
			autoSyncEnabled: DEFAULT_AUTO_SYNC_ENABLED,
		};
	}

	start(reason = "manual", sources?: string[]): boolean {
		if (this.stopped) return false;
		const requested = normalizeSources(sources);
		if (this.running !== null || this.controller !== null) {
			// A pass is already running (or starting): remember this request and
			// run it after. The controller guard also covers a re-entrant start
			// from a status listener while `importAll` is called.
			this.mergePending(reason, requested);
			return false;
		}
		this.begin(reason, requested);
		return true;
	}

	requestSources(sources: string[]): void {
		if (this.stopped || !this.status.autoSyncEnabled) return;
		const requested = normalizeSources(sources);
		if (!requested) return;
		if (this.running !== null || this.controller !== null) {
			this.mergePending("watcher", requested);
			return;
		}
		this.begin("watcher", requested);
	}

	cancel(): boolean {
		if (!this.running || !this.controller || this.controller.signal.aborted) {
			return false;
		}
		// A cancelled pass must not chain a queued one.
		this.clearPending();
		this.controller.abort();
		return true;
	}

	getStatus(): SyncStatus {
		// Shallow copy: callers may embed it but must not mutate the machine.
		return { ...this.status };
	}

	subscribe(listener: SyncListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	setAutoSyncEnabled(enabled: boolean): void {
		this.status = { ...this.status, autoSyncEnabled: enabled };
		this.notify();
	}

	async stop(): Promise<void> {
		this.stopped = true;
		this.clearPending();
		this.controller?.abort();
		const running = this.running;
		if (running) {
			try {
				await running;
			} catch {
				// `execute` already turns failures into status; nothing to do here.
			}
		}
		this.listeners.clear();
	}

	private clearPending(): void {
		this.pendingAll = false;
		this.pendingSources.clear();
		this.pendingReason = null;
	}

	private mergePending(reason: string, sources?: string[]): void {
		if (sources === undefined) {
			this.pendingAll = true;
		} else {
			for (const source of sources) this.pendingSources.add(source);
		}
		this.pendingReason = reason;
	}

	private begin(reason: string, sources?: string[]): void {
		const controller = new AbortController();
		const startedAt = Date.now();
		const scope = sources ? sources.join(", ") : "all enabled sources";
		console.log(`[Sync] Starting ${reason} sync (${scope})`);
		this.controller = controller;
		this.status = {
			...this.status,
			phase: "syncing",
			startedAt,
			finishedAt: undefined,
			error: undefined,
		};
		this.notify();
		const running = this.execute(sources, controller, startedAt);
		this.running = running;
	}

	private async execute(
		sources: string[] | undefined,
		controller: AbortController,
		startedAt: number,
	): Promise<void> {
		let progress: ImportProgress | undefined;
		let failure: unknown = null;
		try {
			progress = await this.importAllFn({
				sources,
				signal: controller.signal,
				onProgress: (next) => {
					this.status = { ...this.status, progress: next };
					this.notify();
				},
			});
		} catch (err) {
			failure = err;
		}

		const finishedAt = Date.now();
		const cancelled =
			controller.signal.aborted ||
			Boolean(progress?.cancelled) ||
			isAbortError(failure);
		const lastResult: SyncLastResult | undefined = progress
			? {
					total: progress.total,
					imported: progress.imported,
					replaced: progress.replaced,
					skipped: progress.skipped,
					errors: progress.errors,
					durationMs:
						typeof progress.durationMs === "number"
							? progress.durationMs
							: finishedAt - startedAt,
				}
			: undefined;

		this.status = {
			...this.status,
			phase: cancelled ? "cancelled" : failure ? "error" : "idle",
			finishedAt,
			lastCompletedAt: finishedAt,
			progress: progress ?? this.status.progress,
			...(lastResult ? { lastResult } : {}),
			...(failure
				? { error: cancelled ? undefined : errorMessage(failure) }
				: {}),
		};

		this.controller = null;
		this.running = null;
		this.notify();
		this.runPending();
	}

	/** Start the merged request (if any) after the current pass settled. */
	private runPending(): void {
		if (this.stopped) {
			this.clearPending();
			return;
		}
		// A re-entrant listener may already have started a pass from the final
		// notification; the pending request then runs when that pass settles.
		if (this.running !== null || this.controller !== null) return;
		const hasPending = this.pendingAll || this.pendingSources.size > 0;
		if (!hasPending) return;
		const reason = this.pendingReason ?? "watcher";
		const sources = this.pendingAll ? undefined : [...this.pendingSources];
		this.clearPending();
		this.begin(reason, sources);
	}

	private notify(): void {
		const snapshot = this.getStatus();
		for (const listener of [...this.listeners]) {
			try {
				listener(snapshot);
			} catch (err) {
				// One broken subscriber (e.g. a dead SSE socket) must not stop
				// the others or the sync pass.
				console.warn("[Sync] Status listener failed:", errorMessage(err));
			}
		}
	}
}

/** Process-wide manager used by the watcher and the HTTP routes. */
export const syncManager: SyncManager = new SyncEngine();

/**
 * Run one background pass shortly after server start. Called by `createServer`
 * only in local mode; a disabled auto-sync turns it into a no-op.
 */
export function scheduleStartupSync(
	delayMs = STARTUP_SYNC_DELAY_MS,
	manager: SyncManager = syncManager,
): ReturnType<typeof setTimeout> {
	const timer = setTimeout(() => {
		if (!manager.getStatus().autoSyncEnabled) return;
		manager.start("startup");
	}, delayMs);
	if (typeof timer.unref === "function") timer.unref();
	return timer;
}
