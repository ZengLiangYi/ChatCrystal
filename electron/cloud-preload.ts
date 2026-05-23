import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("chatcrystalElectronCloud", {
	allowInsecureHttpAuth: true,
	origin: window.location.origin,
});
