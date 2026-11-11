/**
 * Parser pool — parallel conversation parsing over `worker_threads`.
 *
 * Importing a history is CPU-bound: every conversation is a JSONL file whose
 * messages are parsed, cleaned and rebuilt on the main thread. The pool hands
 * one `adapter.parse(meta)` call at a time to a small set of reusable workers,
 * so a large import runs several parsers at once and the event loop stays free
 * for the API while it happens.
 *
 * Runtime layout:
 * - dev (`tsx` runs `parse-pool.ts`): the sibling `parse-worker.ts` is loaded
 *   through tsx's ESM loader (`execArgv: ["--import", "tsx"]`), which resolves
 *   the code base's `.js` import specifiers to the `.ts` sources.
 * - build (`tsc` output under `server/dist`): the sibling `parse-worker.js` is
 *   loaded directly with no extra flags.
 *
 * Workers are spawned lazily up to `size`, reused for later conversations, and
 * replaced when one exits unexpectedly. If workers cannot be created at all
 * (a packaged runtime that forbids threads, a missing loader, ...) the pool
 * degrades to parsing inline on the main thread and warns only once.
 *
 * Environment inheritance: `Worker` copies `process.env` when it is created, so
 * `DATA_DIR` / `CHATCRYSTAL_*` variables set before `createParsePool()` (or
 * before its first parse) reach the workers, and with them `appConfig`.
 */

import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type {
	ConversationMeta,
	ParsedConversation,
} from "@chatcrystal/shared";
import { getAdapter } from "../parser/index.js";
import type {
	ParseWorkerRequest,
	ParseWorkerResponse,
} from "./parse-worker.js";

/** A conversation to parse plus the source adapter that owns it. */
export type ParsePoolMeta = ConversationMeta & { adapterName: string };

export interface ParsePool {
	parse(meta: ParsePoolMeta): Promise<ParsedConversation>;
	close(): Promise<void>;
	readonly size: number;
}

export interface CreateParsePoolOptions {
	/**
	 * Worker count. Takes precedence over `CHATCRYSTAL_PARSE_WORKERS`; `0`
	 * disables worker threads and parses inline.
	 */
	size?: number;
	/** Integration/test hook: worker entry to load instead of the sibling file. */
	workerPath?: string;
	/** Integration/test hook: skip workers entirely and parse inline. */
	forceInline?: boolean;
	/** How long a freshly spawned worker may take to come online. */
	startupTimeoutMs?: number;
}

const DEFAULT_MAX_WORKERS = 4;
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const TERMINATE_TIMEOUT_MS = 2_000;
const ENV_WORKER_COUNT = "CHATCRYSTAL_PARSE_WORKERS";
const UNKNOWN_ADAPTER = "Unknown parser adapter";
const WORKER_CLOSED = "Parser pool is closed";

/** Worker count: explicit option > env var > bounded CPU count. */
function resolvePoolSize(explicit: number | undefined): number {
	if (explicit !== undefined && Number.isFinite(explicit)) {
		return Math.max(0, Math.floor(explicit));
	}
	const fromEnv = process.env[ENV_WORKER_COUNT]?.trim();
	if (fromEnv) {
		const parsed = Number.parseInt(fromEnv, 10);
		if (Number.isFinite(parsed) && parsed >= 0) return parsed;
	}
	return Math.min(
		DEFAULT_MAX_WORKERS,
		Math.max(1, availableParallelism() - 1),
	);
}

/**
 * The worker entry file next to this module. Under tsx the running module is
 * `.ts`, so the worker must be the `.ts` source too (and needs the tsx loader);
 * a build runs `.js` files and needs no flags.
 */
function resolveWorkerUrl(workerPath: string | undefined): URL {
	if (workerPath) return pathToFileURL(resolve(workerPath));
	const workerFile = import.meta.url.endsWith(".ts")
		? "parse-worker.ts"
		: "parse-worker.js";
	return new URL(`./${workerFile}`, import.meta.url);
}

function resolveWorkerExecArgv(): string[] {
	// tsx registers an ESM loader in the parent process; a worker starts from
	// the same Node defaults, so it needs the loader again to run `.ts`.
	return import.meta.url.endsWith(".ts") ? ["--import", "tsx"] : [];
}

function errorMessage(value: unknown): string {
	return value instanceof Error ? value.message : String(value);
}

function toError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

/** Parse on the main thread, exactly as `import.ts` does without a pool. */
async function parseInline(meta: ParsePoolMeta): Promise<ParsedConversation> {
	const adapter = getAdapter(meta.adapterName);
	if (!adapter) throw new Error(`${UNKNOWN_ADAPTER}: ${meta.adapterName}`);
	return adapter.parse(meta);
}

interface PoolTask {
	id: number;
	meta: ParsePoolMeta;
	resolve(parsed: ParsedConversation): void;
	reject(error: Error): void;
}

interface WorkerSlot {
	worker: Worker;
	/** Task currently assigned to the worker, if any. */
	current: PoolTask | null;
	/** Set once the slot leaves the pool; later events are ignored. */
	removed: boolean;
	/** Set once the worker's thread came online. */
	everOnline: boolean;
	/** Fires if the worker never comes online (packaged runtime limitation). */
	startupTimer: NodeJS.Timeout;
}

/**
 * Stop a worker, but do not let a wedged thread hang shutdown: give it
 * `TERMINATE_TIMEOUT_MS` to exit, then move on (terminate was already asked).
 */
async function terminateWorker(worker: Worker): Promise<void> {
	const exited = worker.terminate().then(
		() => undefined,
		() => undefined,
	);
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<void>((done) => {
		timer = setTimeout(done, TERMINATE_TIMEOUT_MS);
		timer.unref();
	});
	await Promise.race([exited, timeout]);
	if (timer) clearTimeout(timer);
}

class ParserPool implements ParsePool {
	readonly size: number;

	private readonly workerUrl: URL;
	private readonly execArgv: string[];
	private readonly startupTimeoutMs: number;
	private readonly slots: WorkerSlot[] = [];
	private readonly queue: PoolTask[] = [];
	/** True when tasks are parsed on the main thread instead of in workers. */
	private degraded: boolean;
	private warned = false;
	private closed = false;
	private closePromise: Promise<void> | null = null;
	/** Whether any worker has ever answered (later exits are recoverable). */
	private everCompleted = false;
	private nextTaskId = 1;

	constructor(options: CreateParsePoolOptions) {
		this.size = resolvePoolSize(options.size);
		this.workerUrl = resolveWorkerUrl(options.workerPath);
		this.execArgv = resolveWorkerExecArgv();
		this.startupTimeoutMs =
			options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
		this.degraded = options.forceInline === true || this.size === 0;
	}

	parse(meta: ParsePoolMeta): Promise<ParsedConversation> {
		if (this.closed) return Promise.reject(new Error(WORKER_CLOSED));
		if (this.degraded) return parseInline(meta);

		return new Promise<ParsedConversation>((resolveTask, rejectTask) => {
			this.queue.push({
				id: this.nextTaskId++,
				meta,
				resolve: resolveTask,
				reject: rejectTask,
			});
			this.dispatch();
		});
	}

	close(): Promise<void> {
		this.closePromise ??= this.doClose();
		return this.closePromise;
	}

	private async doClose(): Promise<void> {
		this.closed = true;
		this.degraded = true;

		const queued = this.queue.splice(0, this.queue.length);
		for (const task of queued) task.reject(new Error(WORKER_CLOSED));

		const stops: Promise<void>[] = [];
		for (const slot of this.slots.splice(0, this.slots.length)) {
			slot.removed = true;
			clearTimeout(slot.startupTimer);
			const task = slot.current;
			slot.current = null;
			if (task) task.reject(new Error(WORKER_CLOSED));
			stops.push(terminateWorker(slot.worker));
		}
		await Promise.all(stops);
	}

	/** Hand queued tasks to idle workers, spawning more workers up to `size`. */
	private dispatch(): void {
		if (this.closed) return;
		if (this.degraded) {
			this.flushInline();
			return;
		}

		while (this.queue.length > 0) {
			const idle = this.slots.find((slot) => !slot.removed && !slot.current);
			if (idle) {
				const task = this.queue.shift();
				if (task) this.assign(idle, task);
				continue;
			}

			if (this.slots.length >= this.size) {
				// Every worker is busy; the next completed task continues here.
				return;
			}

			const spawned = this.spawnWorker();
			if (!spawned) {
				// Worker creation failed: parse everything on the main thread.
				this.flushInline();
				return;
			}
			const task = this.queue.shift();
			if (task) this.assign(spawned, task);
		}
	}

	private assign(slot: WorkerSlot, task: PoolTask): void {
		slot.current = task;
		const request: ParseWorkerRequest = {
			id: task.id,
			adapterName: task.meta.adapterName,
			meta: task.meta,
		};
		try {
			slot.worker.postMessage(request);
		} catch (error) {
			// The worker died between dispatch and postMessage: handle it the
			// same way as an `error`/`exit` event for this slot.
			this.handleSlotFailure(slot, toError(error));
		}
	}

	private spawnWorker(): WorkerSlot | null {
		let worker: Worker;
		try {
			worker = new Worker(this.workerUrl, {
				execArgv: this.execArgv,
				// Copy the env at spawn time so worker-side appConfig sees the
				// same DATA_DIR / CHATCRYSTAL_* values as the parent.
				env: { ...process.env },
			});
		} catch (error) {
			this.degrade(error);
			return null;
		}

		const slot: WorkerSlot = {
			worker,
			current: null,
			removed: false,
			everOnline: false,
			startupTimer: setTimeout(() => {
				if (slot.removed || this.closed || slot.everOnline) return;
				this.handleSlotFailure(
					slot,
					new Error("Parser worker did not come online in time"),
				);
				void worker.terminate().catch(() => undefined);
			}, this.startupTimeoutMs),
		};
		slot.startupTimer.unref();
		this.slots.push(slot);

		worker.once("online", () => {
			slot.everOnline = true;
			clearTimeout(slot.startupTimer);
		});
		worker.on("message", (response: ParseWorkerResponse) => {
			this.handleWorkerMessage(slot, response);
		});
		worker.on("messageerror", (error: Error) => {
			this.handleSlotFailure(slot, error);
		});
		worker.on("error", (error: Error) => {
			this.handleSlotFailure(slot, error);
		});
		worker.on("exit", (code: number) => {
			if (slot.removed || this.closed) return;
			this.handleSlotFailure(
				slot,
				new Error(`Parser worker exited unexpectedly (code ${code})`),
			);
		});
		return slot;
	}

	private handleWorkerMessage(
		slot: WorkerSlot,
		response: ParseWorkerResponse,
	): void {
		if (slot.removed) return;
		const task = slot.current;
		if (!task || task.id !== response.id) return;

		slot.current = null;
		// Any reply proves the worker runtime itself works; later crashes are
		// recoverable and should not degrade the whole pool.
		this.everCompleted = true;
		if (response.ok) {
			task.resolve(response.parsed);
		} else {
			task.reject(new Error(response.error));
		}
		this.dispatch();
	}

	/**
	 * A worker failed (startup error, `postMessage` failure, crash, exit).
	 * Before the first successful parse this means workers cannot run at all,
	 * so the pool degrades to inline parsing; afterwards only this slot is
	 * replaced and the assigned task fails while others continue.
	 */
	private handleSlotFailure(slot: WorkerSlot, error: Error): void {
		if (slot.removed) return;
		slot.removed = true;
		clearTimeout(slot.startupTimer);
		const index = this.slots.indexOf(slot);
		if (index >= 0) this.slots.splice(index, 1);
		if (this.closed) return;

		const failedTask = slot.current;
		slot.current = null;

		if (!this.everCompleted) {
			this.degrade(error);
			if (failedTask) this.runInline(failedTask);
		} else if (failedTask) {
			failedTask.reject(error);
		}

		this.dispatch();
	}

	private degrade(reason: unknown): void {
		if (this.degraded) return;
		this.degraded = true;
		if (this.warned) return;
		this.warned = true;
		console.warn(
			`[ParsePool] worker threads unavailable, falling back to inline parsing: ${errorMessage(reason)}`,
		);
	}

	/** Run every queued task on the main thread (after degradation). */
	private flushInline(): void {
		const queued = this.queue.splice(0, this.queue.length);
		for (const task of queued) this.runInline(task);
	}

	private runInline(task: PoolTask): void {
		void parseInline(task.meta).then(task.resolve, task.reject);
	}
}

/**
 * Create a parse pool. Workers are spawned on demand and shut down by
 * `close()`; without an explicit `size` the pool uses
 * `min(4, max(1, cpus - 1))` workers unless `CHATCRYSTAL_PARSE_WORKERS` says
 * otherwise. `CHATCRYSTAL_PARSE_WORKERS=0` parses inline.
 */
export function createParsePool(
	options: CreateParsePoolOptions = {},
): ParsePool {
	return new ParserPool(options);
}
