import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import Fastify from "fastify";

// The routes module imports the service layer, which resolves the runtime data
// directory at import time. Point it at a throwaway fixture so the test never
// touches the developer's real ChatCrystal data.
const dataDir = mkdtempSync(join(tmpdir(), "chatcrystal-sync-route-"));
process.env.DATA_DIR = dataDir;

const { syncRoutes, normalizeRequestedSources } = await import("./sync.js");
type SyncManager = import("../services/sync.js").SyncManager;
type SyncStatus = import("../services/sync.js").SyncStatus;

test.after(() => {
	rmSync(dataDir, { recursive: true, force: true });
});

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
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
		await sleep(5);
	}
}

/** A state-machine stand-in whose status the test controls. */
function createFakeManager(
	initial: SyncStatus = { phase: "idle", autoSyncEnabled: true },
) {
	let status: SyncStatus = initial;
	const listeners = new Set<(status: SyncStatus) => void>();
	const calls = {
		starts: [] as Array<{ reason?: string; sources?: string[] }>,
		cancels: 0,
	};
	const emit = (): void => {
		for (const listener of [...listeners]) listener({ ...status });
	};
	const manager: SyncManager = {
		start(reason?: string, sources?: string[]) {
			calls.starts.push({ reason, sources });
			status = { ...status, phase: "syncing", startedAt: Date.now() };
			emit();
			return true;
		},
		cancel() {
			calls.cancels++;
			status = { ...status, phase: "cancelled" };
			emit();
			return true;
		},
		getStatus() {
			return { ...status };
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		setAutoSyncEnabled(enabled) {
			status = { ...status, autoSyncEnabled: enabled };
			emit();
		},
		async stop() {},
		requestSources(sources) {
			calls.starts.push({ reason: "watcher", sources });
		},
	};
	return {
		manager,
		calls,
		setStatus(next: SyncStatus): void {
			status = next;
			emit();
		},
		listenerCount: (): number => listeners.size,
	};
}

function createApp(manager: SyncManager, heartbeatMs = 15_000) {
	const app = Fastify();
	void app.register(syncRoutes, { manager, heartbeatMs });
	return app;
}

interface SseBlock {
	event?: string;
	data?: string;
}

function parseSseBlock(block: string): SseBlock {
	const parsed: SseBlock = {};
	for (const line of block.split("\n")) {
		if (line.startsWith("event: ")) parsed.event = line.slice("event: ".length);
		else if (line.startsWith("data: ")) parsed.data = line.slice("data: ".length);
	}
	return parsed;
}

function createSseReader(response: Response) {
	assert.ok(response.body, "SSE response must have a body");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	return {
		async readUntil(needle: string, timeoutMs = 2000): Promise<string> {
			const deadline = Date.now() + timeoutMs;
			for (;;) {
				const index = buffer.indexOf(needle);
				if (index >= 0) {
					const end = index + needle.length;
					const chunk = buffer.slice(0, end);
					buffer = buffer.slice(end);
					return chunk;
				}
				if (Date.now() > deadline) {
					throw new Error(
						`timed out waiting for ${JSON.stringify(needle)} (buffer=${JSON.stringify(buffer)})`,
					);
				}
				const { value, done } = await reader.read();
				if (done) throw new Error("SSE stream ended unexpectedly");
				buffer += decoder.decode(value, { stream: true });
			}
		},
		async close(): Promise<void> {
			await reader.cancel().catch(() => {});
		},
	};
}

test("GET /api/sync/status returns the current sync status", async () => {
	const fake = createFakeManager();
	const app = createApp(fake.manager);
	try {
		const first = await app.inject({ method: "GET", url: "/api/sync/status" });
		assert.equal(first.statusCode, 200);
		assert.deepEqual(first.json(), {
			success: true,
			data: { phase: "idle", autoSyncEnabled: true },
		});

		fake.setStatus({ phase: "syncing", autoSyncEnabled: false, startedAt: 123 });
		const second = await app.inject({ method: "GET", url: "/api/sync/status" });
		assert.equal(second.statusCode, 200);
		assert.equal(second.json().data.phase, "syncing");
		assert.equal(second.json().data.autoSyncEnabled, false);
		assert.equal(second.json().data.startedAt, 123);
	} finally {
		await app.close();
	}
});

test("POST /api/sync/start accepts local origins and filters requested sources", async () => {
	const fake = createFakeManager();
	const app = createApp(fake.manager);
	try {
		const response = await app.inject({
			method: "POST",
			url: "/api/sync/start",
			headers: { origin: "http://localhost:13721" },
			payload: { sources: ["codex", "", "  ", "codex", 7, "gemini"] },
		});
		assert.equal(response.statusCode, 202);
		assert.deepEqual(response.json(), {
			success: true,
			data: { started: true },
		});
		assert.deepEqual(fake.calls.starts, [
			{ reason: "api", sources: ["codex", "gemini"] },
		]);

		// No body / no sources means "all enabled sources".
		const full = await app.inject({
			method: "POST",
			url: "/api/sync/start",
		});
		assert.equal(full.statusCode, 202);
		assert.equal(fake.calls.starts[1]?.sources, undefined);
	} finally {
		await app.close();
	}
});

test("POST /api/sync/start rejects non-local browser origins", async () => {
	const fake = createFakeManager();
	const app = createApp(fake.manager);
	try {
		const response = await app.inject({
			method: "POST",
			url: "/api/sync/start",
			headers: { origin: "https://example.com" },
		});
		assert.equal(response.statusCode, 403);
		assert.equal(response.json().success, false);
		assert.equal(fake.calls.starts.length, 0);

		// A referer from another site is rejected as well.
		const referer = await app.inject({
			method: "POST",
			url: "/api/sync/start",
			headers: { referer: "https://example.com/page" },
		});
		assert.equal(referer.statusCode, 403);
		assert.equal(fake.calls.starts.length, 0);
	} finally {
		await app.close();
	}
});

test("POST /api/sync/start is disabled in cloud mode", async () => {
	const previous = process.env.CHATCRYSTAL_CLOUD_MODE;
	process.env.CHATCRYSTAL_CLOUD_MODE = "true";
	const fake = createFakeManager();
	const app = createApp(fake.manager);
	try {
		const response = await app.inject({
			method: "POST",
			url: "/api/sync/start",
			headers: { origin: "http://localhost:13721" },
		});
		assert.equal(response.statusCode, 400);
		assert.match(response.json().error, /local-only/i);
		assert.equal(fake.calls.starts.length, 0);
	} finally {
		if (previous === undefined) delete process.env.CHATCRYSTAL_CLOUD_MODE;
		else process.env.CHATCRYSTAL_CLOUD_MODE = previous;
		await app.close();
	}
});

test("POST /api/sync/cancel reports whether a pass was cancelled", async () => {
	const fake = createFakeManager();
	const app = createApp(fake.manager);
	try {
		const response = await app.inject({ method: "POST", url: "/api/sync/cancel" });
		assert.equal(response.statusCode, 200);
		assert.deepEqual(response.json(), {
			success: true,
			data: { cancelled: true },
		});
		assert.equal(fake.calls.cancels, 1);
	} finally {
		await app.close();
	}
});

test("normalizeRequestedSources keeps unique non-empty source names", () => {
	assert.equal(normalizeRequestedSources(undefined), undefined);
	assert.equal(normalizeRequestedSources("codex"), undefined);
	assert.deepEqual(normalizeRequestedSources([]), undefined);
	assert.deepEqual(normalizeRequestedSources(["", "  ", 1, null]), undefined);
	assert.deepEqual(
		normalizeRequestedSources([" codex ", "codex", "gemini", ""]),
		["codex", "gemini"],
	);
});

test("GET /api/sync/stream sends the current status, changes and heartbeats", async () => {
	const fake = createFakeManager();
	const app = createApp(fake.manager, 25);
	const abort = new AbortController();
	let sse: ReturnType<typeof createSseReader> | null = null;
	try {
		await app.listen({ port: 0, host: "127.0.0.1" });
		const address = app.server.address() as AddressInfo;
		const response = await fetch(
			`http://127.0.0.1:${address.port}/api/sync/stream`,
			{ signal: abort.signal, headers: { accept: "text/event-stream" } },
		);
		assert.equal(response.status, 200);
		assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);

		sse = createSseReader(response);
		const initial = parseSseBlock(await sse.readUntil("\n\n"));
		assert.equal(initial.event, "status");
		assert.deepEqual(JSON.parse(initial.data ?? "{}"), {
			phase: "idle",
			autoSyncEnabled: true,
		});

		// Every state change is pushed as one `status` event.
		fake.setStatus({ phase: "syncing", autoSyncEnabled: true, startedAt: 42 });
		const changed = parseSseBlock(await sse.readUntil("\n\n"));
		assert.equal(changed.event, "status");
		assert.equal(JSON.parse(changed.data ?? "{}").phase, "syncing");

		// A comment heartbeat keeps proxies from closing an idle stream.
		const heartbeat = await sse.readUntil(": heartbeat\n\n", 2000);
		assert.match(heartbeat, /: heartbeat\n\n$/);

		assert.equal(fake.listenerCount(), 1);
		abort.abort();
		await sse.close();
		await waitFor(() => fake.listenerCount() === 0, "SSE unsubscribe");
	} finally {
		abort.abort();
		await sse?.close();
		await app.close();
	}
});
