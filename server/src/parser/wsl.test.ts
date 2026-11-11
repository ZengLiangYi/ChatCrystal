import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	clearWslHomeCache,
	getWslHomes,
	setWslHomesForTesting,
} from './wsl.js';

const fixtureRoot = mkdtempSync(join(tmpdir(), 'chatcrystal-wsl-test-'));
const homeA = join(fixtureRoot, 'home-a');
const homeB = join(fixtureRoot, 'home-b');
mkdirSync(homeA, { recursive: true });
mkdirSync(homeB, { recursive: true });

const originalFlag = process.env.CHATCRYSTAL_WSL;
const originalHomes = process.env.CHATCRYSTAL_WSL_HOMES;

test.after(() => {
	setWslHomesForTesting(null);
	restoreEnv('CHATCRYSTAL_WSL', originalFlag);
	restoreEnv('CHATCRYSTAL_WSL_HOMES', originalHomes);
	rmSync(fixtureRoot, { recursive: true, force: true });
});

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}

function withEnv(vars: Record<string, string>): void {
	// Start from a clean pair of WSL variables so tests do not leak into each
	// other, then apply what this test needs.
	delete process.env.CHATCRYSTAL_WSL;
	delete process.env.CHATCRYSTAL_WSL_HOMES;
	for (const [name, value] of Object.entries(vars)) process.env[name] = value;
	clearWslHomeCache();
}

function clearEnv(...names: string[]): void {
	for (const name of names) delete process.env[name];
	clearWslHomeCache();
}

test('forced homes are reported with env labels', () => {
	withEnv({ CHATCRYSTAL_WSL_HOMES: `${homeA};${homeB}` });
	const homes = getWslHomes();
	assert.equal(homes.length, 2);
	assert.equal(homes[0].home, homeA);
	assert.equal(homes[1].home, homeB);
	assert.match(homes[0].distro, /^env-/);
});

test('CHATCRYSTAL_WSL=0 disables discovery', () => {
	withEnv({ CHATCRYSTAL_WSL: '0', CHATCRYSTAL_WSL_HOMES: homeA });
	assert.deepEqual(getWslHomes(), []);
});

test('non-Windows hosts report no homes unless forced', () => {
	clearEnv('CHATCRYSTAL_WSL', 'CHATCRYSTAL_WSL_HOMES');
	if (process.platform === 'win32') {
		// On Windows the real environment decides; the test only asserts that
		// discovery never throws and every entry looks like a home path.
		for (const home of getWslHomes()) {
			assert.equal(typeof home.distro, 'string');
			assert.ok(home.home.length > 0);
		}
	} else {
		assert.deepEqual(getWslHomes(), []);
	}
});

test('test override wins over environment and cache', () => {
	withEnv({ CHATCRYSTAL_WSL: '0', CHATCRYSTAL_WSL_HOMES: homeA });
	setWslHomesForTesting([homeB]);
	const homes = getWslHomes();
	assert.equal(homes.length, 1);
	assert.equal(homes[0].home, homeB);
	setWslHomesForTesting(null);
	assert.deepEqual(getWslHomes(), []);
});

test('homes are cached until explicitly cleared', () => {
	withEnv({ CHATCRYSTAL_WSL_HOMES: homeA });
	assert.equal(getWslHomes().length, 1);
	// Change the env without clearing the cache: the cached result stays.
	process.env.CHATCRYSTAL_WSL_HOMES = `${homeA};${homeB}`;
	assert.equal(getWslHomes().length, 1);
	clearWslHomeCache();
	assert.equal(getWslHomes().length, 2);
});
