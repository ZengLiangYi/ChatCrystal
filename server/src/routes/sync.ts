/**
 * Background sync API.
 *
 * - GET  /api/sync/status  current sync state (JSON)
 * - POST /api/sync/start   start a background pass (local-only + origin guard)
 * - POST /api/sync/cancel  abort the running pass
 * - GET  /api/sync/stream  Server-Sent Events: one `status` event on connect and
 *                          one per state change, with a heartbeat comment every
 *                          15s so proxies keep the connection alive.
 *
 * The manager is injectable (`register(syncRoutes, { manager })`) so route tests
 * can drive the state machine without starting a real import.
 */

import type { FastifyInstance } from "fastify";
import { isCloudMode } from "../runtime/cloud.js";
import { syncManager, type SyncManager } from "../services/sync.js";
import { isLocalImportRequestOriginAllowed } from "./import.js";

const DEFAULT_HEARTBEAT_MS = 15_000;

export interface SyncRoutesOptions {
	/** Manager to serve; defaults to the process-wide `syncManager`. */
	manager?: SyncManager;
	/** Heartbeat interval for SSE (tests lower it). */
	heartbeatMs?: number;
}

interface SyncStartBody {
	sources?: unknown;
}

/** Keep only non-empty source names from a request body. */
export function normalizeRequestedSources(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const sources: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string") continue;
		const trimmed = entry.trim();
		if (trimmed && !sources.includes(trimmed)) sources.push(trimmed);
	}
	return sources.length > 0 ? sources : undefined;
}

export async function syncRoutes(
	app: FastifyInstance,
	options: SyncRoutesOptions = {},
): Promise<void> {
	const manager = options.manager ?? syncManager;
	const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;

	// SSE connections are owned by this plugin: close them when the server
	// shuts down so a long-lived stream cannot block Fastify's `close()`.
	const activeStreams = new Set<() => void>();
	app.addHook("onClose", async () => {
		for (const closeStream of [...activeStreams]) closeStream();
	});

	app.get("/api/sync/status", async () => {
		return { success: true, data: manager.getStatus() };
	});

	app.post("/api/sync/start", async (req, reply) => {
		if (isCloudMode()) {
			reply.status(400);
			return {
				success: false,
				error:
					"Background sync is local-only and is disabled in cloud mode. Run the sync on the device that has the source histories.",
			};
		}
		// Starting an import is a local side effect: only same-machine browser
		// origins (or CLI/Electron requests without a browser origin) may do it.
		// Same guard as the local import routes.
		if (
			!isLocalImportRequestOriginAllowed(
				req.headers.origin,
				req.headers.referer,
			)
		) {
			reply.status(403);
			return {
				success: false,
				error: "Background sync must be started from ChatCrystal.",
			};
		}

		const body = (req.body ?? {}) as SyncStartBody;
		const sources = normalizeRequestedSources(body.sources);
		const started = manager.start("api", sources);
		reply.status(202);
		return { success: true, data: { started } };
	});

	app.post("/api/sync/cancel", async () => {
		return { success: true, data: { cancelled: manager.cancel() } };
	});

	app.get("/api/sync/stream", async (req, reply) => {
		// Take the raw socket over: this response never ends on its own.
		reply.hijack();
		const raw = reply.raw;
		raw.writeHead(200, {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});
		raw.flushHeaders();

		let closed = false;
		let unsubscribe: (() => void) | null = null;
		let heartbeat: ReturnType<typeof setInterval> | null = null;

		const send = (event: string, data: unknown): void => {
			if (closed) return;
			try {
				raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
			} catch {
				cleanup();
			}
		};

		const cleanup = (): void => {
			if (closed) return;
			closed = true;
			activeStreams.delete(cleanup);
			if (heartbeat) clearInterval(heartbeat);
			heartbeat = null;
			unsubscribe?.();
			unsubscribe = null;
			try {
				raw.end();
			} catch {
				// The client is already gone.
			}
		};
		activeStreams.add(cleanup);

		// A client that connects mid-pass immediately gets the current state.
		send("status", manager.getStatus());
		unsubscribe = manager.subscribe((status) => send("status", status));

		heartbeat = setInterval(() => {
			if (closed) return;
			try {
				raw.write(": heartbeat\n\n");
			} catch {
				cleanup();
			}
		}, heartbeatMs);
		if (typeof heartbeat.unref === "function") heartbeat.unref();

		req.raw.on("close", cleanup);
		req.raw.on("error", cleanup);
		raw.on("close", cleanup);

		// Hold the handler open until the client disconnects; cleanup is driven
		// by the socket close events above.
		await new Promise<void>((resolve) => {
			req.raw.once("close", () => resolve());
		});
	});
}
