export {};

declare global {
	interface Window {
		chatcrystalElectronCloud?: {
			allowInsecureHttpAuth: boolean;
			origin: string;
		};
	}
}
