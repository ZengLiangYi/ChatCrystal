/**
 * Rewrite the onboarding entry's asset URLs for the packaged Electron app.
 *
 * The Vite build serves the main SPA from http://localhost:3721, so it emits
 * absolute `/assets/...` URLs. The desktop onboarding page is loaded from a
 * `file://` URL inside the ASAR (`client/dist/electron-onboarding/index.html`),
 * where `/assets/...` resolves to the drive root and the page renders blank.
 * Rewriting those URLs to `../assets/...` makes them resolve next to the built
 * client dist, while the web build stays untouched.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const distDir = path.resolve(import.meta.dirname, "..", "dist");
const htmlPath = path.join(distDir, "electron-onboarding", "index.html");

if (!existsSync(htmlPath)) {
	console.error("[build] onboarding index.html not found:", htmlPath);
	process.exit(1);
}

const html = readFileSync(htmlPath, "utf-8");
const rewritten = html.replace(
	/\b(src|href)="(\/(?!\/)[^"]*)"/g,
	(_match, attr, url) => `${attr}="..${url}"`,
);

if (rewritten === html) {
	console.error("[build] no absolute onboarding asset URLs were rewritten");
	process.exit(1);
}

const remaining = [...rewritten.matchAll(/\b(?:src|href)="(\/(?!\/)[^"]*)"/g)];
if (remaining.length > 0) {
	console.error(
		"[build] onboarding page still has absolute asset URLs:",
		remaining.map((match) => match[1]),
	);
	process.exit(1);
}

writeFileSync(htmlPath, rewritten);
console.log("[build] rewrote onboarding asset URLs for file:// loading");
