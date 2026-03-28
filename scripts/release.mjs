#!/usr/bin/env node
/**
 * Release helper: bumps version, creates git tag, pushes to trigger CI.
 *
 * Usage:
 *   npm run release              → patch (0.1.0 → 0.1.1)
 *   npm run release -- minor     → minor (0.1.1 → 0.2.0)
 *   npm run release -- major     → major (0.2.0 → 1.0.0)
 *   npm run release -- 0.3.0     → explicit version
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, "../package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

const arg = process.argv[2] || "patch";
const run = (cmd) => execSync(cmd, { stdio: "inherit", cwd: resolve(__dirname, "..") });

// Ensure clean working tree
try {
	execSync("git diff --quiet && git diff --cached --quiet", {
		cwd: resolve(__dirname, ".."),
	});
} catch {
	console.error("Error: Working tree is not clean. Commit or stash changes first.");
	process.exit(1);
}

// Determine next version
let nextVersion;
if (/^\d+\.\d+\.\d+/.test(arg)) {
	nextVersion = arg;
} else {
	const [major, minor, patch] = pkg.version.split(".").map(Number);
	switch (arg) {
		case "major":
			nextVersion = `${major + 1}.0.0`;
			break;
		case "minor":
			nextVersion = `${major}.${minor + 1}.0`;
			break;
		case "patch":
			nextVersion = `${major}.${minor}.${patch + 1}`;
			break;
		default:
			console.error(`Unknown bump type: ${arg}. Use patch/minor/major or explicit version.`);
			process.exit(1);
	}
}

const tag = `v${nextVersion}`;
console.log(`\nReleasing ${pkg.name} ${tag}\n`);

// Bump version in package.json (no git tag from npm)
run(`npm version ${nextVersion} --no-git-tag-version`);

// Commit version bump
run(`git add package.json package-lock.json`);
run(`git commit -m "chore: release ${tag}"`);

// Create annotated tag
run(`git tag -a ${tag} -m "Release ${tag}"`);

// Push commit + tag
run(`git push origin main --follow-tags`);

console.log(`\n✅ ${tag} pushed. GitHub Actions will build and publish the release.\n`);
console.log(`   Track progress: https://github.com/ZengLiangYi/ChatCrystal/actions\n`);
