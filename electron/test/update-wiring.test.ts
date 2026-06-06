import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const electronRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const clientRoot = path.resolve(electronRoot, "..", "client");

function readElectronSource(relativePath: string) {
	return readFileSync(path.join(electronRoot, relativePath), "utf-8");
}

function readClientSource(relativePath: string) {
	return readFileSync(path.join(clientRoot, relativePath), "utf-8");
}

test("tray menu exposes manual update checks without adding an application menu item", () => {
	const tray = readElectronSource("tray.ts");
	const appMenu = readElectronSource("app-menu.ts");
	const main = readElectronSource("main.ts");

	assert.match(tray, /检查更新\.\.\./);
	assert.match(tray, /checkForUpdates/);
	assert.match(main, /requestManualUpdateCheck/);
	assert.doesNotMatch(appMenu, /检查更新/);
});

test("preload exposes update actions to the renderer", () => {
	const preload = readElectronSource("preload.ts");
	const types = readClientSource("src/types/electron.d.ts");

	assert.match(preload, /updates:/);
	assert.match(preload, /ipcRenderer\.invoke\("updates:check"/);
	assert.match(preload, /ipcRenderer\.invoke\("updates:open-release-page"/);
	assert.match(preload, /ipcRenderer\.invoke\("updates:skip-version"/);
	assert.match(preload, /ipcRenderer\.invoke\("updates:remind-later"/);
	assert.match(types, /updates\?:/);
	assert.match(types, /check: \(input: \{ manual: boolean \}\)/);
});

test("shared banner prioritizes update copy over the GitHub star copy", () => {
	const banner = readClientSource("src/components/StarBanner.tsx");

	assert.match(banner, /update\.available_banner/);
	assert.match(banner, /star\.message/);
	assert.match(banner, /window\.electronAPI\?\.updates/);
});

test("settings page renders update controls only through the Electron bridge", () => {
	const settings = readClientSource("src/pages/SettingsPage.tsx");

	assert.match(settings, /section\.updates/);
	assert.match(settings, /updates\.check/);
	assert.match(settings, /update\.check/);
	assert.match(settings, /update\.open_releases/);
	assert.match(settings, /window\.electronAPI\?\.updates/);
});
