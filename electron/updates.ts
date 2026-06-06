import { app, shell } from "electron";
import {
	readElectronState,
	writeElectronState,
	type ElectronUpdateState,
} from "./state";

export const DEFAULT_UPDATE_API_URL =
	"https://api.github.com/repos/ZengLiangYi/ChatCrystal/releases/latest";
export const DEFAULT_UPDATE_RELEASES_URL =
	"https://github.com/ZengLiangYi/ChatCrystal/releases";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export type UpdateRelease = {
	tagName: string;
	htmlUrl: string;
	publishedAt?: string | null;
};

export type UpdateCheckResult =
	| {
			status: "available";
			currentVersion: string;
			latestVersion: string;
			releaseUrl: string;
			publishedAt?: string | null;
	  }
	| {
			status: "not-available";
			currentVersion: string;
			latestVersion: string;
			releaseUrl: string;
	  }
	| {
			status: "error";
			currentVersion: string;
			message: string;
			releaseUrl: string;
	  }
	| {
			status: "silent-error";
			currentVersion: string;
	  }
	| {
			status: "skipped";
			currentVersion: string;
	  };

type CheckForUpdatesOptions = {
	currentVersion?: string;
	manual: boolean;
	userDataDir?: string;
	fetchLatestRelease?: () => Promise<UpdateRelease>;
};

type GitHubReleasePayload = {
	tag_name?: unknown;
	html_url?: unknown;
	published_at?: unknown;
};

function normalizeVersionTag(tag: string): string | null {
	const match = tag
		.trim()
		.match(/^(?:electron-)?v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/i);
	return match?.[1] ?? null;
}

function compareVersions(a: string, b: string): number {
	const [aCore, aPre = ""] = a.split("-", 2);
	const [bCore, bPre = ""] = b.split("-", 2);
	const aParts = aCore.split(".").map((part) => Number.parseInt(part, 10));
	const bParts = bCore.split(".").map((part) => Number.parseInt(part, 10));
	for (let index = 0; index < 3; index += 1) {
		const diff = (aParts[index] ?? 0) - (bParts[index] ?? 0);
		if (diff !== 0) return diff;
	}
	if (aPre === bPre) return 0;
	if (!aPre) return 1;
	if (!bPre) return -1;
	return aPre.localeCompare(bPre);
}

function isReminderActive(state: ElectronUpdateState, now = Date.now()): boolean {
	if (!state.remindAfter) return false;
	const remindAt = Date.parse(state.remindAfter);
	return Number.isFinite(remindAt) && remindAt > now;
}

function shouldSuppressAvailableUpdate(
	state: ElectronUpdateState,
	latestVersion: string,
	manual: boolean,
): boolean {
	if (manual) return false;
	if (state.skippedVersion === latestVersion) return true;
	return isReminderActive(state);
}

function updateStoredState(
	patch: Partial<ElectronUpdateState>,
	userDataDir?: string,
): ElectronUpdateState {
	const state = readElectronState(userDataDir);
	const update = { ...state.update, ...patch };
	try {
		writeElectronState({ ...state, update }, userDataDir);
	} catch {
		// Unit tests may exercise update logic outside Electron's main process.
	}
	return update;
}

export function getUpdateState(userDataDir?: string): ElectronUpdateState {
	return readElectronState(userDataDir).update;
}

export function shouldRunAutomaticUpdateCheck(userDataDir?: string): boolean {
	const lastCheckedAt = getUpdateState(userDataDir).lastCheckedAt;
	if (!lastCheckedAt) return true;
	const lastChecked = Date.parse(lastCheckedAt);
	if (!Number.isFinite(lastChecked)) return true;
	return Date.now() - lastChecked >= ONE_DAY_MS;
}

export function skipUpdateVersion(version: string, userDataDir?: string): void {
	updateStoredState({ skippedVersion: version, lastSeenVersion: version }, userDataDir);
}

export function remindUpdateLater(version: string, userDataDir?: string): void {
	updateStoredState(
		{
			lastSeenVersion: version,
			remindAfter: new Date(Date.now() + ONE_DAY_MS).toISOString(),
		},
		userDataDir,
	);
}

export async function fetchLatestGitHubRelease(): Promise<UpdateRelease> {
	const response = await fetch(DEFAULT_UPDATE_API_URL, {
		headers: {
			Accept: "application/vnd.github+json",
			"User-Agent": "ChatCrystal-Electron",
		},
	});
	if (!response.ok) {
		throw new Error(`GitHub Releases returned HTTP ${response.status}`);
	}

	const payload = (await response.json()) as GitHubReleasePayload;
	if (typeof payload.tag_name !== "string" || typeof payload.html_url !== "string") {
		throw new Error("GitHub Releases returned an invalid response");
	}

	return {
		tagName: payload.tag_name,
		htmlUrl: payload.html_url,
		publishedAt:
			typeof payload.published_at === "string" ? payload.published_at : null,
	};
}

export async function checkForUpdates(
	options: CheckForUpdatesOptions,
): Promise<UpdateCheckResult> {
	const currentVersion = options.currentVersion ?? app.getVersion();
	if (!options.manual && !shouldRunAutomaticUpdateCheck(options.userDataDir)) {
		return { status: "skipped", currentVersion };
	}

	try {
		const release = await (options.fetchLatestRelease ?? fetchLatestGitHubRelease)();
		const latestVersion = normalizeVersionTag(release.tagName);
		if (!latestVersion) {
			throw new Error(`Unsupported release tag: ${release.tagName}`);
		}

		updateStoredState(
			{
				lastCheckedAt: new Date().toISOString(),
				lastSeenVersion: latestVersion,
			},
			options.userDataDir,
		);

		if (compareVersions(latestVersion, currentVersion) <= 0) {
			return {
				status: "not-available",
				currentVersion,
				latestVersion,
				releaseUrl: release.htmlUrl,
			};
		}

		const updateState = getUpdateState(options.userDataDir);
		if (shouldSuppressAvailableUpdate(updateState, latestVersion, options.manual)) {
			return { status: "skipped", currentVersion };
		}

		return {
			status: "available",
			currentVersion,
			latestVersion,
			releaseUrl: release.htmlUrl,
			publishedAt: release.publishedAt,
		};
	} catch (error) {
		if (!options.manual) {
			updateStoredState(
				{ lastCheckedAt: new Date().toISOString() },
				options.userDataDir,
			);
			return { status: "silent-error", currentVersion };
		}

		const message = error instanceof Error ? error.message : String(error);
		return {
			status: "error",
			currentVersion,
			message,
			releaseUrl: DEFAULT_UPDATE_RELEASES_URL,
		};
	}
}

export async function openUpdateReleasePage(url: string): Promise<void> {
	const target = url.trim() || DEFAULT_UPDATE_RELEASES_URL;
	const parsed = new URL(target);
	if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
		throw new Error("更新链接必须指向 GitHub Releases 页面");
	}
	await shell.openExternal(target);
}
