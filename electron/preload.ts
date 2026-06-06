import { contextBridge, ipcRenderer } from "electron";

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
	updates: {
		check: (input: { manual: boolean }) => ipcRenderer.invoke("updates:check", input),
		openReleasePage: (url: string) =>
			ipcRenderer.invoke("updates:open-release-page", url),
		skipVersion: (version: string) =>
			ipcRenderer.invoke("updates:skip-version", version),
		remindLater: (version: string) =>
			ipcRenderer.invoke("updates:remind-later", version),
		onManualCheckRequested: (callback: () => void) => {
			const listener = () => {
				callback();
			};
			ipcRenderer.on("updates:manual-check-requested", listener);
			return () =>
				ipcRenderer.removeListener("updates:manual-check-requested", listener);
		},
	},
});
