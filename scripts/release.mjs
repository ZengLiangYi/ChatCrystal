#!/usr/bin/env node
/**
 * Release helper: bumps version, creates git tag, pushes to trigger CI.
 *
 * Usage:
 *   npm run release              → bump both (patch), tag v*
 *   npm run release -- minor     → bump both (minor)
 *
 *   npm run release:npm           → bump npm only (patch), tag npm-v*
 *   npm run release:npm -- minor  → bump npm only (minor)
 *
 *   npm run release:electron           → bump electron only (patch), tag electron-v*
 *   npm run release:electron -- minor  → bump electron only (minor)
 *
 * Explicit version: npm run release:npm -- 0.3.0
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const run = (cmd) => execSync(cmd, { stdio: "inherit", cwd: root });

// Determine target from RELEASE_TARGET env or default to "all"
const target = process.env.RELEASE_TARGET || "all";
const arg = process.argv[2] || "patch";

// Ensure clean working tree
try {
	execSync("git diff --quiet && git diff --cached --quiet", { cwd: root });
} catch {
	console.error("Error: Working tree is not clean. Commit or stash changes first.");
	process.exit(1);
}

function readPkg(path) {
	return JSON.parse(readFileSync(path, "utf-8"));
}

function bumpVersion(currentVersion, bump) {
	if (/^\d+\.\d+\.\d+/.test(bump)) return bump;
	const [major, minor, patch] = currentVersion.split(".").map(Number);
	switch (bump) {
		case "major": return `${major + 1}.0.0`;
		case "minor": return `${major}.${minor + 1}.0`;
		case "patch": return `${major}.${minor}.${patch + 1}`;
		default:
			console.error(`Unknown bump type: ${bump}. Use patch/minor/major or explicit version.`);
			process.exit(1);
	}
}

function writePkgVersion(path, version) {
	const pkg = readPkg(path);
	pkg.version = version;
	writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

const rootPkgPath = resolve(root, "package.json");
const serverPkgPath = resolve(root, "server/package.json");
const filesToStage = [];
let tag;

if (target === "npm" || target === "all") {
	const serverPkg = readPkg(serverPkgPath);
	const npmVersion = bumpVersion(serverPkg.version, arg);
	writePkgVersion(serverPkgPath, npmVersion);
	filesToStage.push("server/package.json");
	console.log(`  npm: ${serverPkg.version} → ${npmVersion}`);

	if (target === "npm") {
		tag = `npm-v${npmVersion}`;
	}
}

if (target === "electron" || target === "all") {
	const rootPkg = readPkg(rootPkgPath);
	const electronVersion = bumpVersion(rootPkg.version, arg);
	writePkgVersion(rootPkgPath, electronVersion);
	filesToStage.push("package.json");
	console.log(`  electron: ${rootPkg.version} → ${electronVersion}`);

	if (target === "electron") {
		tag = `electron-v${electronVersion}`;
	}
}

if (target === "all") {
	// For full release, use root package.json version as tag
	const rootPkg = readPkg(rootPkgPath);
	tag = `v${rootPkg.version}`;
}

console.log(`\nReleasing ${tag}\n`);

// Update lockfile
run("npm install --package-lock-only");
filesToStage.push("package-lock.json");

// Commit and tag
run(`git add ${filesToStage.join(" ")}`);
run(`git commit -m "chore: release ${tag}"`);
run(`git tag -a ${tag} -m "Release ${tag}"`);
run(`git push origin main --follow-tags`);

console.log(`\n✅ ${tag} pushed. GitHub Actions will build and publish.\n`);
console.log(`   Track progress: https://github.com/ZengLiangYi/ChatCrystal/actions\n`);
