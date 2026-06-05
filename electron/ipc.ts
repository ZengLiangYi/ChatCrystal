import { ipcMain, type IpcMainInvokeEvent } from "electron";

export type IpcDeps = {
	getOnboardingOrigin: () => string;
	getOnboardingUrl: () => string;
	getState(): Promise<unknown> | unknown;
	saveCloudConnection(input: { baseUrl: string; token: string }): Promise<unknown>;
	startLocal(): Promise<unknown>;
	importLocalHistory(): Promise<unknown>;
	uploadLocalHistory(): Promise<unknown>;
	testModel(mode: "local" | "cloud"): Promise<unknown>;
	summarizeBatch(input: { mode: "local" | "cloud"; conversationIds: string[] }): Promise<unknown>;
	getMcpSnippet(mode: "local" | "cloud"): Promise<unknown>;
	openApp(mode: "local" | "cloud"): Promise<unknown>;
	useTemporaryLocal(): Promise<unknown>;
};

export type CloudIpcDeps = {
	getCloudOrigin: () => string;
	uploadLocalHistory(): Promise<unknown>;
};

function assertOnboardingSender(
	event: IpcMainInvokeEvent,
	expectedOrigin: string,
	expectedUrl: string,
): void {
	if (
		!event.senderFrame ||
		event.senderFrame.origin !== expectedOrigin ||
		event.senderFrame.url !== expectedUrl
	) {
		throw new Error("Rejected onboarding IPC from unexpected origin");
	}
}

function assertCloudSender(event: IpcMainInvokeEvent, expectedOrigin: string): void {
	if (!event.senderFrame || event.senderFrame.origin !== expectedOrigin) {
		throw new Error("Rejected cloud IPC from unexpected origin");
	}
}

function assertMode(value: unknown): asserts value is "local" | "cloud" {
	if (value !== "local" && value !== "cloud") {
		throw new Error("Invalid onboarding mode");
	}
}

function assertConversationIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
}

export function registerOnboardingIpc(deps: IpcDeps): void {
	const guard = (event: IpcMainInvokeEvent) =>
		assertOnboardingSender(event, deps.getOnboardingOrigin(), deps.getOnboardingUrl());

	ipcMain.handle("onboarding:get-state", (event) => {
		guard(event);
		return deps.getState();
	});
	ipcMain.handle("onboarding:save-cloud-connection", (event, input) => {
		guard(event);
		return deps.saveCloudConnection(input);
	});
	ipcMain.handle("onboarding:start-local", (event) => {
		guard(event);
		return deps.startLocal();
	});
	ipcMain.handle("onboarding:import-local-history", (event) => {
		guard(event);
		return deps.importLocalHistory();
	});
	ipcMain.handle("onboarding:upload-local-history", (event) => {
		guard(event);
		return deps.uploadLocalHistory();
	});
	ipcMain.handle("onboarding:test-model", (event, mode) => {
		guard(event);
		assertMode(mode);
		return deps.testModel(mode);
	});
	ipcMain.handle("onboarding:summarize-batch", (event, input) => {
		guard(event);
		const payload = input as { mode?: unknown; conversationIds?: unknown };
		assertMode(payload?.mode);
		return deps.summarizeBatch({
			mode: payload.mode,
			conversationIds: assertConversationIds(payload.conversationIds),
		});
	});
	ipcMain.handle("onboarding:get-mcp-snippet", (event, mode) => {
		guard(event);
		assertMode(mode);
		return deps.getMcpSnippet(mode);
	});
	ipcMain.handle("onboarding:open-app", (event, mode) => {
		guard(event);
		assertMode(mode);
		return deps.openApp(mode);
	});
	ipcMain.handle("onboarding:use-temporary-local", (event) => {
		guard(event);
		return deps.useTemporaryLocal();
	});
}

export function registerCloudIpc(deps: CloudIpcDeps): void {
	ipcMain.handle("cloud:upload-local-history", (event) => {
		assertCloudSender(event, deps.getCloudOrigin());
		return deps.uploadLocalHistory();
	});
}
