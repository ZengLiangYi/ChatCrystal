import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { wslRootsFor, withWslRoots } from './sourceRoots.js';
import { setWslHomesForTesting } from './wsl.js';

const fixtureRoot = mkdtempSync(join(tmpdir(), 'chatcrystal-roots-test-'));
const primaryRoot = join(fixtureRoot, 'primary', '.codex', 'sessions');
const wslHome = join(fixtureRoot, 'wsl-home');
const wslRoot = join(wslHome, '.codex', 'sessions');
mkdirSync(primaryRoot, { recursive: true });
mkdirSync(wslRoot, { recursive: true });

const originalHomes = process.env.CHATCRYSTAL_WSL_HOMES;
delete process.env.CHATCRYSTAL_WSL_HOMES;

test.after(() => {
	setWslHomesForTesting(null);
	if (originalHomes === undefined) delete process.env.CHATCRYSTAL_WSL_HOMES;
	else process.env.CHATCRYSTAL_WSL_HOMES = originalHomes;
	rmSync(fixtureRoot, { recursive: true, force: true });
});

test('without WSL homes only the primary root is returned', () => {
	setWslHomesForTesting([]);
	assert.deepEqual(withWslRoots(primaryRoot, '.codex/sessions'), [primaryRoot]);
	assert.deepEqual(wslRootsFor('.codex/sessions'), []);
});

test('WSL roots are appended when the relative folder exists', () => {
	setWslHomesForTesting([wslHome]);
	assert.deepEqual(withWslRoots(primaryRoot, '.codex/sessions'), [
		primaryRoot,
		wslRoot,
	]);
	assert.deepEqual(wslRootsFor('.codex/sessions'), [wslRoot]);
});

test('missing relative folders are skipped per WSL home', () => {
	setWslHomesForTesting([wslHome, join(fixtureRoot, 'other-home')]);
	assert.deepEqual(withWslRoots(primaryRoot, '.codex/sessions'), [
		primaryRoot,
		wslRoot,
	]);
	assert.deepEqual(wslRootsFor('.claude/projects'), []);
});

test('the primary root stays first even when it does not exist yet', () => {
	setWslHomesForTesting([wslHome]);
	const missingPrimary = join(fixtureRoot, 'missing', '.codex', 'sessions');
	const roots = withWslRoots(missingPrimary, '.codex/sessions');
	assert.equal(roots[0], missingPrimary);
	assert.ok(roots.includes(wslRoot));
});

test('identical primary and WSL roots are deduplicated', () => {
	const home = join(fixtureRoot, 'home-that-is-the-primary');
	mkdirSync(join(home, '.codex', 'sessions'), { recursive: true });
	setWslHomesForTesting([home]);
	const duplicatePrimary = join(home, '.codex', 'sessions');
	assert.deepEqual(withWslRoots(duplicatePrimary, '.codex/sessions'), [
		duplicatePrimary,
	]);
});
