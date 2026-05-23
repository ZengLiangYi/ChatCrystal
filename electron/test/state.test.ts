import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	DEFAULT_ELECTRON_STATE,
	getElectronStatePath,
	readElectronState,
	redactToken,
	writeElectronState,
} from "../state.js";

test("electron onboarding state persists cloud token as plaintext JSON", () => {
	const userDataDir = mkdtempSync(path.join(tmpdir(), "chatcrystal-electron-state-test-"));
	try {
		writeElectronState({
			...DEFAULT_ELECTRON_STATE,
			mode: "cloud",
			defaultMode: "cloud",
			cloudBaseUrl: "https://crystal.example.com",
			cloudToken: "plain-token",
			importSkipped: true,
		}, userDataDir);

		const filePath = getElectronStatePath(userDataDir);
		const raw = readFileSync(filePath, "utf-8");
		assert.match(raw, /"cloudToken": "plain-token"/);

		const state = readElectronState(userDataDir);
		assert.equal(state.mode, "cloud");
		assert.equal(state.defaultMode, "cloud");
		assert.equal(state.cloudBaseUrl, "https://crystal.example.com");
		assert.equal(state.cloudToken, "plain-token");
		assert.equal(state.importSkipped, true);
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});

test("electron onboarding state falls back to defaults when JSON is corrupted", () => {
	const userDataDir = mkdtempSync(path.join(tmpdir(), "chatcrystal-electron-state-test-"));
	try {
		writeFileSync(getElectronStatePath(userDataDir), "{not json", "utf-8");
		assert.deepEqual(readElectronState(userDataDir), DEFAULT_ELECTRON_STATE);
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});

test("redactToken keeps token readable enough for support without exposing the secret", () => {
	assert.equal(redactToken(null), null);
	assert.equal(redactToken("short"), "****");
	assert.equal(redactToken("token-1234567890"), "toke****7890");
});
