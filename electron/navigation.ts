export function isAllowedOriginUrl(rawUrl: string, allowedOrigin: string): boolean {
	try {
		return new URL(rawUrl).origin === allowedOrigin;
	} catch {
		return false;
	}
}

export function isExternalBrowserUrl(rawUrl: string, allowedOrigin: string): boolean {
	try {
		const url = new URL(rawUrl);
		return (
			(url.protocol === "http:" || url.protocol === "https:") &&
			url.origin !== allowedOrigin
		);
	} catch {
		return false;
	}
}
