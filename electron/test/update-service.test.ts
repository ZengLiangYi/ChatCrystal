import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	DEFAULT_UPDATE_RELEASES_URL,
	checkForUpdates,
	getUpdateState,
	remindUpdateLater,
	shouldRunAutomaticUpdateCheck,
	skipUpdateVersion,
	type UpdateRelease,
} from "../updates.js";

const currentVersion = "0.5.0";

function release(patch: Partial<UpdateRelease> = {}): UpdateRelease {
	return {
		tagName: "v0.5.1",
		htmlUrl: "https://github.com/ZengLiangYi/ChatCrystal/releases/tag/v0.5.1",
		publishedAt: "2026-06-06T00:00:00.000Z",
		...patch,
	};
}

test("manual update check reports an available GitHub release without release notes", async () => {
	const result = await checkForUpdates({
		currentVersion,
		manual: true,
		fetchLatestRelease: async () => release(),
	});

	assert.equal(result.status, "available");
	assert.equal(result.currentVersion, "0.5.0");
	assert.equal(result.latestVersion, "0.5.1");
	assert.equal(result.releaseUrl, release().htmlUrl);
	assert.equal(result.publishedAt, "2026-06-06T00:00:00.000Z");
	assert.equal("releaseNotes" in result, false);
});

test("update check treats electron-prefixed tags as desktop releases", async () => {
	const result = await checkForUpdates({
		currentVersion,
		manual: true,
		fetchLatestRelease: async () => release({ tagName: "electron-v0.5.2" }),
	});

	assert.equal(result.status, "available");
	assert.equal(result.latestVersion, "0.5.2");
});

test("manual update check returns a visible error with the releases fallback URL", async () => {
	const result = await checkForUpdates({
		currentVersion,
		manual: true,
		fetchLatestRelease: async () => {
			throw new Error("network unavailable");
		},
	});

	assert.equal(result.status, "error");
	assert.equal(result.currentVersion, currentVersion);
	assert.match(result.message, /network unavailable/);
	assert.equal(result.releaseUrl, DEFAULT_UPDATE_RELEASES_URL);
});

test("automatic update check keeps network failures silent", async () => {
	const userDataDir = mkdtempSync(path.join(tmpdir(), "chatcrystal-update-test-"));
	try {
	const result = await checkForUpdates({
		currentVersion,
		manual: false,
		userDataDir,
		fetchLatestRelease: async () => {
			throw new Error("network unavailable");
		},
	});

	assert.equal(result.status, "silent-error");
	assert.equal(shouldRunAutomaticUpdateCheck(userDataDir), false);
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});

test("update reminder and skipped version state persists", () => {
	const userDataDir = mkdtempSync(path.join(tmpdir(), "chatcrystal-update-test-"));
	try {
		skipUpdateVersion("0.5.1", userDataDir);
		let state = getUpdateState(userDataDir);
		assert.equal(state.skippedVersion, "0.5.1");

		remindUpdateLater("0.5.2", userDataDir);
		state = getUpdateState(userDataDir);
		assert.equal(state.lastSeenVersion, "0.5.2");
		assert.ok(state.remindAfter);
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});

test("automatic update check runs at most once per day", async () => {
	const userDataDir = mkdtempSync(path.join(tmpdir(), "chatcrystal-update-test-"));
	try {
		assert.equal(shouldRunAutomaticUpdateCheck(userDataDir), true);
		await checkForUpdates({
			currentVersion,
			manual: false,
			userDataDir,
			fetchLatestRelease: async () => release(),
		});
		assert.equal(shouldRunAutomaticUpdateCheck(userDataDir), false);
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
