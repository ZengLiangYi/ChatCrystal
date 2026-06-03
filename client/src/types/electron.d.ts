export {};

declare global {
	type ChatCrystalWindowControls = {
		minimize: () => Promise<void>;
		toggleMaximize: () => Promise<void>;
		close: () => Promise<void>;
		isMaximized: () => Promise<boolean>;
		onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void;
	};

	interface Window {
		electronAPI?: {
			isElectron: boolean;
			versions: {
				electron?: string;
				node?: string;
				chrome?: string;
			};
			windowControls?: ChatCrystalWindowControls;
		};
		chatcrystalElectronCloud?: {
			allowInsecureHttpAuth: boolean;
			origin: string;
		};
	}
}
