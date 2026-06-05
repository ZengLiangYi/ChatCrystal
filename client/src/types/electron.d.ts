export {};

declare global {
	type ChatCrystalOnboardingMode = "local" | "cloud";

	type ChatCrystalWindowControls = {
		minimize: () => Promise<void>;
		toggleMaximize: () => Promise<void>;
		close: () => Promise<void>;
		isMaximized: () => Promise<boolean>;
		onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void;
	};

	type ChatCrystalOnboardingApi = {
		getState: () => Promise<{
			mode: ChatCrystalOnboardingMode | null;
			cloudBaseUrl: string | null;
			cloudToken: string | null;
		}>;
		saveCloudConnection: (input: { baseUrl: string; token: string }) => Promise<{
			mode: "cloud";
			cloudBaseUrl?: string;
			httpsRecommended?: boolean;
		}>;
		startLocal: () => Promise<{ mode: "local" }>;
		importLocalHistory: () => Promise<{
			importedCount?: number;
			imported?: number;
			summarizationCandidateIds?: string[];
		}>;
		uploadLocalHistory: () => Promise<{
			importedCount?: number;
			imported?: number;
			summarizationCandidateIds?: string[];
		}>;
		testModel: (mode: ChatCrystalOnboardingMode) => Promise<unknown>;
		summarizeBatch: (input: {
			mode: ChatCrystalOnboardingMode;
			conversationIds: string[];
		}) => Promise<{ summarizedCount?: number }>;
		getMcpSnippet: (mode: ChatCrystalOnboardingMode) => Promise<unknown>;
		openApp: (mode: ChatCrystalOnboardingMode) => Promise<unknown>;
		useTemporaryLocal: () => Promise<unknown>;
	};

	interface Window {
		chatcrystalOnboarding?: ChatCrystalOnboardingApi;
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
			uploadLocalHistory: () => Promise<{
				scanned?: number;
				uploaded?: number;
				imported?: number;
				replaced?: number;
				skipped?: number;
				errors?: number;
				summarizationCandidateIds?: string[];
			}>;
		};
	}
}
