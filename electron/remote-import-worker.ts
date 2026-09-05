import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type ApiEnvelope<T> =
	| { success: true; data: T }
	| { success: false; error?: string };

type WorkerInput = {
	appPath: string;
	cloudBaseUrl: string;
	cloudToken: string;
};

type RemoteImportModule = {
	runRemoteImport: (client: {
		ingestConversations: (request: unknown) => Promise<unknown>;
	}) => Promise<unknown>;
};

async function importServerModule<T>(
	appPath: string,
	relativeModulePath: string,
): Promise<T> {
	const modulePath = path.join(
		appPath,
		"server",
		"dist",
		"server",
		"src",
		relativeModulePath,
	);
	if (!existsSync(modulePath)) {
		throw new Error(
			`Missing compiled server module: ${modulePath}. Run pnpm --filter ./server build before using Electron cloud import.`,
		);
	}
	const moduleUrl = pathToFileURL(modulePath).href;
	return (await Function(
		"specifier",
		"return import(specifier)",
	)(moduleUrl)) as T;
}

function parseInput(): WorkerInput {
	const rawInput = process.argv[2];
	if (!rawInput) {
		throw new Error("Missing remote import worker input");
	}
	const input = JSON.parse(rawInput) as Partial<WorkerInput>;
	if (!input.appPath || !input.cloudBaseUrl || !input.cloudToken) {
		throw new Error("Invalid remote import worker input");
	}
	return {
		appPath: input.appPath,
		cloudBaseUrl: input.cloudBaseUrl,
		cloudToken: input.cloudToken,
	};
}

function getApiError(payload: unknown, fallback: string): string {
	if (payload && typeof payload === "object" && "error" in payload) {
		const error = (payload as { error?: unknown }).error;
		if (typeof error === "string" && error.trim()) return error;
	}
	return fallback;
}

async function requestApi<T>(
	baseUrl: string,
	apiPath: string,
	token: string,
	options: RequestInit = {},
): Promise<T> {
	const headers = new Headers(options.headers);
	headers.set("Authorization", `Bearer ${token}`);
	if (options.body !== undefined && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}

	const response = await fetch(`${baseUrl}${apiPath}`, {
		...options,
		headers,
	});
	const text = await response.text();
	let payload: ApiEnvelope<T> | null = null;
	if (text.trim()) {
		try {
			payload = JSON.parse(text) as ApiEnvelope<T>;
		} catch {
			payload = null;
		}
	}

	if (!response.ok) {
		throw new Error(
			getApiError(payload, `请求失败：HTTP ${response.status}`),
		);
	}
	if (!payload) {
		throw new Error("服务器返回了无效响应");
	}
	if (!payload.success) {
		throw new Error(payload.error || "请求失败");
	}
	return payload.data;
}

async function main(): Promise<void> {
	const input = parseInput();
	const remoteImport = await importServerModule<RemoteImportModule>(
		input.appPath,
		path.join("services", "remoteImport.js"),
	);
	const result = await remoteImport.runRemoteImport({
		ingestConversations: (request) =>
			requestApi(input.cloudBaseUrl, "/api/import/ingest", input.cloudToken, {
				method: "POST",
				body: JSON.stringify(request),
			}),
	});
	process.stdout.write(JSON.stringify({ success: true, data: result }));
}

main().catch((error) => {
	process.stderr.write(error instanceof Error ? error.stack || error.message : String(error));
	process.stdout.write(
		JSON.stringify({
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}),
	);
	process.exit(1);
});
