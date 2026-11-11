/**
 * WSL discovery for Windows hosts.
 *
 * On Windows an agent installed inside a WSL distro keeps its sessions in the
 * distro's home, which Windows opens through `\\wsl.localhost\<distro>` (or the
 * legacy `\\wsl$` alias). The reader here reports the home folders of the
 * distros that are running, so file-based adapters can add them as extra roots
 * and import those sessions like local ones.
 *
 * Design rules:
 * - Only running distros are inspected by default: opening a stopped distro's
 *   files starts it, which the user did not ask for. `CHATCRYSTAL_WSL_DISTROS`
 *   opts specific distros in (they may start on access).
 * - Results are cached for a short time because `\\wsl.localhost` lookups are
 *   slow (and each miss can wake a distro).
 * - `CHATCRYSTAL_WSL=0|false|off` disables WSL discovery entirely;
 *   `CHATCRYSTAL_WSL_HOMES` (semicolon-separated Windows paths) forces homes
 *   and is also the test hook; `setWslHomesForTesting()` overrides per process.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

export interface WslHome {
	/** Distro name, or an `env-<n>` / `test-<n>` label for injected homes. */
	distro: string;
	/** The user's home folder as a Windows path (usually a UNC path). */
	home: string;
}

const CACHE_TTL_MS = 5 * 60_000;
const WSL_UNC_BASES = ["\\\\wsl.localhost", "\\\\wsl$"];

let cache: { homes: WslHome[]; expires: number } | null = null;
let injectedHomes: string[] | null = null;

/** Process-wide override used by tests; `null` restores real discovery. */
export function setWslHomesForTesting(homes: string[] | null): void {
	injectedHomes = homes;
	cache = null;
}

export function clearWslHomeCache(): void {
	cache = null;
}

function envFlag(name: string): string {
	return (process.env[name] ?? "").trim().toLowerCase();
}

function isWslDisabled(): boolean {
	const value = envFlag("CHATCRYSTAL_WSL");
	return value === "0" || value === "false" || value === "off";
}

function splitPathList(value: string): string[] {
	return value
		.split(";")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function splitNameList(value: string): string[] {
	return value
		.split(/[,\s]+/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

/**
 * `wsl.exe` writes UTF-16LE when its output is redirected; plain `sh` output is
 * UTF-8. Decode whichever the buffer looks like.
 */
function decodeWslBuffer(buffer: Buffer): string {
	if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
		return buffer.subarray(2).toString("utf16le");
	}
	if (buffer.length >= 2 && buffer[1] === 0x00) {
		return buffer.toString("utf16le");
	}
	return buffer.toString("utf8");
}

function runWsl(args: string[]): string | null {
	try {
		const output = execFileSync("wsl.exe", args, {
			timeout: 5000,
			windowsHide: true,
			stdio: ["ignore", "pipe", "ignore"],
		});
		return decodeWslBuffer(output).replace(/\0/g, "");
	} catch {
		return null;
	}
}

function listDistros(args: string[]): string[] {
	const output = runWsl(args);
	if (output === null) return [];
	return output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function listUserHomes(distro: string): WslHome[] {
	for (const base of WSL_UNC_BASES) {
		const homeRoot = `${base}\\${distro}\\home`;
		try {
			const users = readdirSync(homeRoot, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name);
			if (users.length > 0) {
				return users.map((user) => ({
					distro,
					home: `${homeRoot}\\${user}`,
				}));
			}
		} catch {
			// Distro not reachable through this provider alias; try the next one.
		}
		const rootHome = `${base}\\${distro}\\root`;
		if (existsSync(rootHome)) {
			return [{ distro, home: rootHome }];
		}
	}
	return [];
}

function askDistroHome(distro: string): WslHome[] {
	const output = runWsl(["-d", distro, "--", "sh", "-c", 'printf %s "$HOME"']);
	const home = output?.trim() ?? "";
	if (!home.startsWith("/")) return [];
	const windowsHome = `\\\\wsl.localhost\\${distro}${home.replace(/\//g, "\\")}`;
	return existsSync(windowsHome) ? [{ distro, home: windowsHome }] : [];
}

function detectWslHomes(): WslHome[] {
	if (isWslDisabled()) return [];

	const forcedHomes = splitPathList(process.env.CHATCRYSTAL_WSL_HOMES ?? "");
	if (forcedHomes.length > 0) {
		return forcedHomes.map((home, index) => ({
			distro: `env-${index}`,
			home,
		}));
	}

	if (process.platform !== "win32") return [];

	const forcedDistros = splitNameList(
		process.env.CHATCRYSTAL_WSL_DISTROS ?? "",
	);
	const distros =
		forcedDistros.length > 0
			? forcedDistros
			: listDistros(["-l", "--running", "-q"]);

	const homes: WslHome[] = [];
	for (const distro of distros) {
		const found = listUserHomes(distro);
		homes.push(...(found.length > 0 ? found : askDistroHome(distro)));
	}
	return homes;
}

/**
 * WSL homes whose sessions can be read right now. Empty on non-Windows hosts,
 * when WSL discovery is disabled, when no distro is running, or when no home
 * can be resolved. Cached for a few minutes.
 */
export function getWslHomes(): WslHome[] {
	if (injectedHomes !== null) {
		return injectedHomes.map((home, index) => ({
			distro: `test-${index}`,
			home,
		}));
	}
	if (cache && Date.now() < cache.expires) return cache.homes;
	const homes = detectWslHomes();
	cache = { homes, expires: Date.now() + CACHE_TTL_MS };
	return homes;
}
