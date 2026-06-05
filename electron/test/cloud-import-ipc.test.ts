import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const electronRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

function readElectronSource(relativePath: string) {
	return readFileSync(path.join(electronRoot, relativePath), "utf-8");
}

test("cloud preload exposes a limited local-history upload bridge", () => {
	const preload = readElectronSource("cloud-preload.ts");

	assert.match(preload, /chatcrystalElectronCloud/);
	assert.match(preload, /uploadLocalHistory/);
	assert.match(preload, /ipcRenderer\.invoke\("cloud:upload-local-history"\)/);
	assert.doesNotMatch(preload, /onboarding:upload-local-history/);
});

test("main process guards cloud import IPC by the active cloud origin", () => {
	const ipc = readElectronSource("ipc.ts");
	const main = readElectronSource("main.ts");

	assert.match(ipc, /export function registerCloudIpc/);
	assert.match(ipc, /assertCloudSender\(event, deps\.getCloudOrigin\(\)\)/);
	assert.match(ipc, /ipcMain\.handle\("cloud:upload-local-history"/);
	assert.match(main, /let currentCloudOrigin = ""/);
	assert.match(main, /currentCloudOrigin = expectedOrigin/);
	assert.match(main, /getCloudOrigin: \(\) => currentCloudOrigin/);
	assert.match(main, /uploadLocalHistory/);
});

test("cloud local-history upload runs in a worker process", () => {
	const main = readElectronSource("main.ts");
	const worker = readElectronSource("remote-import-worker.ts");
	const uploadLocalHistoryBlock =
		main.match(/async function uploadLocalHistory\(\): Promise<unknown> \{[\s\S]*?\n\}/)?.[0] ??
		"";

	assert.match(main, /from "node:child_process"/);
	assert.match(main, /spawn\(/);
	assert.match(main, /remote-import-worker\.js/);
	assert.match(main, /ELECTRON_RUN_AS_NODE/);
	assert.match(main, /activeRemoteImportWorker/);
	assert.match(uploadLocalHistoryBlock, /runRemoteImportWorker/);
	assert.doesNotMatch(uploadLocalHistoryBlock, /\brunRemoteImport\(/);

	assert.match(worker, /runRemoteImport/);
	assert.match(worker, /\/api\/import\/ingest/);
});
