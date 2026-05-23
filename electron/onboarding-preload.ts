import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("chatcrystalOnboarding", {
	getState: () => ipcRenderer.invoke("onboarding:get-state"),
	saveCloudConnection: (input: { baseUrl: string; token: string }) =>
		ipcRenderer.invoke("onboarding:save-cloud-connection", input),
	startLocal: () => ipcRenderer.invoke("onboarding:start-local"),
	importLocalHistory: () => ipcRenderer.invoke("onboarding:import-local-history"),
	uploadLocalHistory: () => ipcRenderer.invoke("onboarding:upload-local-history"),
	testModel: (mode: "local" | "cloud") => ipcRenderer.invoke("onboarding:test-model", mode),
	summarizeBatch: (conversationIds: string[]) =>
		ipcRenderer.invoke("onboarding:summarize-batch", conversationIds),
	getMcpSnippet: (mode: "local" | "cloud") =>
		ipcRenderer.invoke("onboarding:get-mcp-snippet", mode),
	openApp: (mode: "local" | "cloud") => ipcRenderer.invoke("onboarding:open-app", mode),
	useTemporaryLocal: () => ipcRenderer.invoke("onboarding:use-temporary-local"),
});
