import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("chatcrystalOnboarding", {
	getState: () => ipcRenderer.invoke("onboarding:get-state"),
	saveCloudConnection: (input: { baseUrl: string; token: string }) =>
		ipcRenderer.invoke("onboarding:save-cloud-connection", input),
	startLocal: () => ipcRenderer.invoke("onboarding:start-local"),
	importLocalHistory: () => ipcRenderer.invoke("onboarding:import-local-history"),
	uploadLocalHistory: () => ipcRenderer.invoke("onboarding:upload-local-history"),
	testModel: (mode: "local" | "cloud") => ipcRenderer.invoke("onboarding:test-model", mode),
	summarizeBatch: (input: { mode: "local" | "cloud"; conversationIds: string[] }) =>
		ipcRenderer.invoke("onboarding:summarize-batch", input),
	getMcpSnippet: (mode: "local" | "cloud") =>
		ipcRenderer.invoke("onboarding:get-mcp-snippet", mode),
	openApp: (mode: "local" | "cloud") => ipcRenderer.invoke("onboarding:open-app", mode),
	useTemporaryLocal: () => ipcRenderer.invoke("onboarding:use-temporary-local"),
});

contextBridge.exposeInMainWorld("electronAPI", {
	isElectron: true,
	versions: {
		electron: process.versions.electron,
		node: process.versions.node,
		chrome: process.versions.chrome,
	},
	windowControls: {
		minimize: () => ipcRenderer.invoke("window:minimize"),
		toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
		close: () => ipcRenderer.invoke("window:close"),
		isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
		onMaximizedChange: (callback: (isMaximized: boolean) => void) => {
			const listener = (_event: unknown, isMaximized: boolean) => {
				callback(isMaximized);
			};
			ipcRenderer.on("window:maximized-change", listener);
			return () => ipcRenderer.removeListener("window:maximized-change", listener);
		},
	},
});
