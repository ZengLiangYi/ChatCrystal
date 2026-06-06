import {
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

export type ElectronMode = "unset" | "local" | "cloud";

export type ElectronOnboardingState = {
	version: 1;
	mode: ElectronMode;
	defaultMode: Exclude<ElectronMode, "unset"> | null;
	cloudBaseUrl: string | null;
	cloudToken: string | null;
	importSkipped: boolean;
	mcpSkipped: boolean;
	summarizationBatchIds: string[];
	summarizationRequestId: string | null;
	update: ElectronUpdateState;
	updatedAt: string;
};

export type ElectronUpdateState = {
	lastCheckedAt: string | null;
	lastSeenVersion: string | null;
	skippedVersion: string | null;
	remindAfter: string | null;
};

export const DEFAULT_UPDATE_STATE: ElectronUpdateState = {
	lastCheckedAt: null,
	lastSeenVersion: null,
	skippedVersion: null,
	remindAfter: null,
};

export const DEFAULT_ELECTRON_STATE: ElectronOnboardingState = {
	version: 1,
	mode: "unset",
	defaultMode: null,
	cloudBaseUrl: null,
	cloudToken: null,
	importSkipped: false,
	mcpSkipped: false,
	summarizationBatchIds: [],
	summarizationRequestId: null,
	update: DEFAULT_UPDATE_STATE,
	updatedAt: new Date(0).toISOString(),
};

function getDefaultUserDataDir(): string {
	const electron = require("electron") as typeof import("electron") | string;
	if (typeof electron === "string" || !electron.app) {
		throw new Error("Electron app is unavailable outside the Electron main process");
	}
	return electron.app.getPath("userData");
}

export function getElectronStatePath(userDataDir = getDefaultUserDataDir()): string {
	return path.join(userDataDir, "onboarding-state.json");
}

export function redactToken(value: string | null): string | null {
	if (!value) return null;
	if (value.length <= 8) return "****";
	return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

export function readElectronState(userDataDir?: string): ElectronOnboardingState {
	try {
		const parsed = JSON.parse(
			readFileSync(getElectronStatePath(userDataDir), "utf-8"),
		) as Partial<ElectronOnboardingState>;
		if (parsed.version !== 1) return DEFAULT_ELECTRON_STATE;
		return {
			...DEFAULT_ELECTRON_STATE,
			...parsed,
			update: {
				...DEFAULT_UPDATE_STATE,
				...(parsed.update ?? {}),
			},
			updatedAt: parsed.updatedAt ?? new Date().toISOString(),
		};
	} catch {
		return DEFAULT_ELECTRON_STATE;
	}
}

export function writeElectronState(
	next: ElectronOnboardingState,
	userDataDir?: string,
): void {
	const filePath = getElectronStatePath(userDataDir);
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(
		filePath,
		JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2),
		{
			encoding: "utf-8",
			mode: 0o600,
		},
	);
}
