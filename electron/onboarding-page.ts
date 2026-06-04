import path from "node:path";
import { pathToFileURL } from "node:url";

const ONBOARDING_ASSET_PATH = "electron-onboarding/index.html";

export type OnboardingUrlOptions = {
	appPath: string;
	devBaseUrl?: string;
	initialError?: string;
	preview?: boolean;
};

function appendOnboardingParams(
	url: URL,
	{ initialError, preview }: Pick<OnboardingUrlOptions, "initialError" | "preview">,
): string {
	if (initialError?.trim()) {
		url.searchParams.set("initialError", initialError.trim());
	}
	if (preview) {
		url.searchParams.set("preview", "1");
	}
	return url.toString();
}

export function getOnboardingUrl(options: OnboardingUrlOptions): string {
	if (options.devBaseUrl) {
		return appendOnboardingParams(
			new URL(`/${ONBOARDING_ASSET_PATH}`, options.devBaseUrl),
			options,
		);
	}

	return appendOnboardingParams(
		pathToFileURL(
			path.join(options.appPath, "client", "dist", ONBOARDING_ASSET_PATH),
		),
		options,
	);
}
