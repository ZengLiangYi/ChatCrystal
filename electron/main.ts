import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, Menu, screen, session } from "electron";
import { buildApplicationMenuTemplate } from "./app-menu";
import { registerOnboardingIpc } from "./ipc";
import { buildMcpSnippet } from "./mcp-snippets";
import { getOnboardingDataUrl } from "./onboarding-page";
import {
	DEFAULT_ELECTRON_STATE,
	readElectronState,
	redactToken,
	writeElectronState,
	type ElectronOnboardingState,
} from "./state";
import { createTray, destroyTray } from "./tray";

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
}

Menu.setApplicationMenu(null);

type WindowMode = "onboarding" | "local" | "cloud";

interface WindowState {
	x?: number;
	y?: number;
	width: number;
	height: number;
	isMaximized: boolean;
}

type ServerInstance = {
	app: unknown;
	port: number;
	shutdown: () => Promise<void>;
};

type ServerModule = {
	createServer: (opts?: {
		port?: number;
		host?: string;
		startWatcher?: boolean;
	}) => Promise<ServerInstance>;
};

type RemoteImportModule = {
	runRemoteImport: (client: {
		ingestConversations: (request: unknown) => Promise<unknown>;
	}) => Promise<unknown>;
};

type ApiEnvelope<T> =
	| { success: true; data: T }
	| { success: false; error?: string };

const ONBOARDING_ORIGIN = "null";
const API_TOKEN_LOCAL_STORAGE_KEY = "chatcrystal.apiToken";
const AUTH_CHANGED_EVENT = "chatcrystal-auth-changed";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

let mainWindow: BrowserWindow | null = null;
let serverShutdown: (() => Promise<void>) | null = null;
let isQuitting = false;
let serverPort = 3721;
let lastNormalBounds: Electron.Rectangle | null = null;
let currentOnboardingUrl = "";

function getWindowStatePath(): string {
	return path.join(app.getPath("userData"), "window-state.json");
}

function loadWindowState(): WindowState {
	try {
		const data = readFileSync(getWindowStatePath(), "utf-8");
		return JSON.parse(data) as WindowState;
	} catch {
		return { width: 1280, height: 800, isMaximized: false };
	}
}

function saveWindowState(win: BrowserWindow): void {
	const isMaximized = win.isMaximized();
	const bounds = isMaximized
		? (lastNormalBounds ?? win.getBounds())
		: win.getBounds();
	const state: WindowState = {
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		isMaximized,
	};
	try {
		writeFileSync(getWindowStatePath(), JSON.stringify(state));
	} catch {
		// Best effort only.
	}
}

function findFreePort(preferred: number): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(preferred, "127.0.0.1", () => {
			srv.close(() => resolve(preferred));
		});
		srv.on("error", () => {
			const fallback = net.createServer();
			fallback.listen(0, "127.0.0.1", () => {
				const port = (fallback.address() as net.AddressInfo).port;
				fallback.close(() => resolve(port));
			});
			fallback.on("error", (err) => {
				reject(new Error(`Cannot find a free port: ${err.message}`));
			});
		});
	});
}

function getDataDir(): string {
	if (process.env.DATA_DIR) {
		return path.isAbsolute(process.env.DATA_DIR)
			? process.env.DATA_DIR
			: path.resolve(app.getAppPath(), process.env.DATA_DIR);
	}
	return path.join(homedir(), ".chatcrystal", "data");
}

function setRuntimeEnvironment(): void {
	const dataDir = getDataDir();
	mkdirSync(dataDir, { recursive: true });
	process.env.ELECTRON = "true";
	process.env.DATA_DIR = dataDir;
	if (app.isPackaged) {
		process.env.ELECTRON_PACKAGED = "true";
	}
}

function validateSavedPosition(state: WindowState): void {
	if (state.x === undefined || state.y === undefined) return;

	const displays = screen.getAllDisplays();
	const visible = displays.some((display) => {
		const bounds = display.bounds;
		return (
			state.x! >= bounds.x - 50 &&
			state.x! < bounds.x + bounds.width &&
			state.y! >= bounds.y - 50 &&
			state.y! < bounds.y + bounds.height
		);
	});

	if (!visible) {
		state.x = undefined;
		state.y = undefined;
	}
}

function preloadForMode(mode: WindowMode): string {
	if (mode === "cloud") return path.join(__dirname, "cloud-preload.js");
	if (mode === "onboarding") return path.join(__dirname, "onboarding-preload.js");
	return path.join(__dirname, "preload.js");
}

function createWindow(mode: WindowMode): BrowserWindow {
	const state = loadWindowState();
	validateSavedPosition(state);

	const win = new BrowserWindow({
		width: state.width,
		height: state.height,
		x: state.x,
		y: state.y,
		minWidth: 900,
		minHeight: 600,
		show: false,
		title: "ChatCrystal",
		icon: path.join(__dirname, "..", "icon.png"),
		webPreferences: {
			preload: preloadForMode(mode),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	if (state.isMaximized) {
		win.maximize();
	}

	win.on("resize", () => {
		if (!win.isMaximized()) {
			lastNormalBounds = win.getBounds();
		}
	});
	win.on("move", () => {
		if (!win.isMaximized()) {
			lastNormalBounds = win.getBounds();
		}
	});
	win.once("ready-to-show", () => {
		win.show();
	});
	win.on("close", (event) => {
		saveWindowState(win);
		if (!isQuitting) {
			event.preventDefault();
			win.hide();
		}
	});

	return win;
}

function replaceMainWindow(mode: WindowMode): BrowserWindow {
	if (mainWindow && !mainWindow.isDestroyed()) {
		saveWindowState(mainWindow);
		mainWindow.destroy();
	}
	mainWindow = createWindow(mode);
	return mainWindow;
}

function showMainWindow(): void {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	if (mainWindow.isMinimized()) mainWindow.restore();
	mainWindow.show();
	mainWindow.focus();
}

function requestQuit(): void {
	app.quit();
}

function updateApplicationMenu(mode: WindowMode): void {
	const template = buildApplicationMenuTemplate(mode, {
		showMainWindow,
		reconnect: reconnectFromMenu,
		quit: requestQuit,
	});
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function isLocalHttpUrl(rawUrl: string): boolean {
	try {
		const url = new URL(rawUrl);
		return url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
	} catch {
		return false;
	}
}

function configureLocalContentSecurityPolicy(): void {
	if (process.env.VITE_DEV_URL) return;

	session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
		if (!isLocalHttpUrl(details.url)) {
			callback({ responseHeaders: details.responseHeaders });
			return;
		}

		callback({
			responseHeaders: {
				...details.responseHeaders,
				"Content-Security-Policy": [
					"default-src 'self';" +
						" script-src 'self';" +
						" style-src 'self' 'unsafe-inline';" +
						" img-src 'self' data: blob:;" +
						" font-src 'self' data:;" +
						" connect-src 'self' http://localhost:* ws://localhost:*;" +
						" object-src 'none';" +
						" base-uri 'self'",
				],
			},
		});
	});
}

async function importServerModule<T>(relativeModulePath: string): Promise<T> {
	const modulePath = path.join(
		app.getAppPath(),
		"server",
		"dist",
		"server",
		"src",
		relativeModulePath,
	);
	if (!existsSync(modulePath)) {
		throw new Error(
			`Missing compiled server module: ${modulePath}. Run npm run build -w server before packaging Electron.`,
		);
	}
	const moduleUrl = pathToFileURL(modulePath).href;
	return (await Function(
		"specifier",
		"return import(specifier)",
	)(moduleUrl)) as T;
}

async function startServer(port: number): Promise<ServerInstance> {
	const serverModule = await importServerModule<ServerModule>("index.js");
	return serverModule.createServer({
		port,
		host: "127.0.0.1",
		startWatcher: false,
	});
}

function getDevCoreUrl(): string {
	return process.env.CHATCRYSTAL_ELECTRON_DEV_CORE_URL ?? "http://localhost:3721";
}

async function ensureLocalCoreStarted(): Promise<{
	appUrl: string;
	apiBaseUrl: string;
}> {
	const devUrl = process.env.VITE_DEV_URL;
	if (devUrl) {
		return { appUrl: devUrl, apiBaseUrl: getDevCoreUrl() };
	}

	if (!serverShutdown) {
		serverPort = await findFreePort(3721);
		if (serverPort !== 3721) {
			console.log(`[Electron] Port 3721 occupied, using port ${serverPort}`);
		}
		const server = await startServer(serverPort);
		serverShutdown = server.shutdown;
	}

	const localUrl = `http://localhost:${serverPort}`;
	return { appUrl: localUrl, apiBaseUrl: localUrl };
}

function normalizeCloudBaseUrl(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new Error("请输入云端地址");
	}

	const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)
		? trimmed
		: `https://${trimmed}`;
	const url = new URL(withProtocol);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("云端地址必须使用 HTTP 或 HTTPS");
	}
	url.hash = "";
	url.search = "";
	return url.toString().replace(/\/+$/, "");
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
	options: RequestInit = {},
): Promise<T> {
	const headers = new Headers(options.headers);
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

function withAuth(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

async function verifyCloudConnection(baseUrl: string, token: string): Promise<void> {
	const status = await requestApi<{
		cloudMode: boolean;
		setupRequired: boolean;
		authenticated: boolean;
	}>(baseUrl, "/api/setup/status");

	if (!status.cloudMode) {
		throw new Error("该地址不是 ChatCrystal 云端核心");
	}
	if (status.setupRequired) {
		throw new Error("云端核心尚未完成初始设置");
	}

	const verify = await requestApi<{ authenticated: boolean }>(
		baseUrl,
		"/api/auth/verify",
		{
			method: "POST",
			headers: withAuth(token),
			body: JSON.stringify({}),
		},
	);
	if (!verify.authenticated) {
		throw new Error("Token 验证失败");
	}
}

function readConfiguredCloudState(): ElectronOnboardingState {
	const state = readElectronState();
	if (!state.cloudBaseUrl || !state.cloudToken) {
		throw new Error("请先配置云端地址和 token");
	}
	return state;
}

function writeModeState(
	mode: "local" | "cloud",
	patch: Partial<ElectronOnboardingState> = {},
): ElectronOnboardingState {
	const current = readElectronState();
	const next: ElectronOnboardingState = {
		...current,
		...patch,
		version: 1,
		mode,
		defaultMode: patch.defaultMode === undefined ? mode : patch.defaultMode,
	};
	writeElectronState(next);
	return next;
}

async function saveCloudConnection(input: {
	baseUrl: string;
	token: string;
}): Promise<{ mode: "cloud"; cloudBaseUrl: string; httpsRecommended: boolean }> {
	const token = input.token.trim();
	if (!token) {
		throw new Error("请输入访问 token");
	}
	const cloudBaseUrl = normalizeCloudBaseUrl(input.baseUrl);
	await verifyCloudConnection(cloudBaseUrl, token);
	writeModeState("cloud", {
		cloudBaseUrl,
		cloudToken: token,
		importSkipped: false,
		mcpSkipped: false,
		summarizationBatchIds: [],
		summarizationRequestId: null,
	});
	return {
		mode: "cloud",
		cloudBaseUrl,
		httpsRecommended: new URL(cloudBaseUrl).protocol === "http:",
	};
}

async function startLocalMode(): Promise<{
	mode: "local";
	appUrl: string;
	apiBaseUrl: string;
}> {
	const local = await ensureLocalCoreStarted();
	writeModeState("local", {
		importSkipped: false,
		mcpSkipped: false,
		summarizationBatchIds: [],
		summarizationRequestId: null,
	});
	return { mode: "local", ...local };
}

async function getModeApiBaseUrl(mode: "local" | "cloud"): Promise<{
	baseUrl: string;
	token?: string;
}> {
	if (mode === "local") {
		const local = await ensureLocalCoreStarted();
		return { baseUrl: local.apiBaseUrl };
	}

	const state = readConfiguredCloudState();
	return { baseUrl: state.cloudBaseUrl!, token: state.cloudToken! };
}

async function callModeApi<T>(
	mode: "local" | "cloud",
	apiPath: string,
	options: RequestInit = {},
): Promise<T> {
	const target = await getModeApiBaseUrl(mode);
	const headers = new Headers(options.headers);
	if (target.token) {
		headers.set("Authorization", `Bearer ${target.token}`);
	}
	return requestApi<T>(target.baseUrl, apiPath, { ...options, headers });
}

async function importLocalHistory(): Promise<unknown> {
	return callModeApi("local", "/api/import/scan", { method: "POST" });
}

async function uploadLocalHistory(): Promise<unknown> {
	const state = readConfiguredCloudState();
	const remoteImport = await importServerModule<RemoteImportModule>(
		path.join("services", "remoteImport.js"),
	);

	return remoteImport.runRemoteImport({
		ingestConversations: (request) =>
			requestApi(state.cloudBaseUrl!, "/api/import/ingest", {
				method: "POST",
				headers: withAuth(state.cloudToken!),
				body: JSON.stringify(request),
			}),
	});
}

async function testModel(mode: "local" | "cloud"): Promise<unknown> {
	return callModeApi(mode, "/api/config/test", { method: "POST" });
}

async function summarizeBatch(input: {
	mode: "local" | "cloud";
	conversationIds: string[];
}): Promise<unknown> {
	const result = await callModeApi(input.mode, "/api/summarize/batch-ids", {
		method: "POST",
		body: JSON.stringify({ conversationIds: input.conversationIds }),
	});
	writeModeState(input.mode, {
		summarizationBatchIds: input.conversationIds,
		summarizationRequestId: new Date().toISOString(),
	});
	return result;
}

async function getMcpSnippet(mode: "local" | "cloud"): Promise<unknown> {
	if (mode === "local") {
		const local = await ensureLocalCoreStarted();
		return buildMcpSnippet({ mode: "local", baseUrl: local.apiBaseUrl });
	}

	const state = readConfiguredCloudState();
	return buildMcpSnippet({
		mode: "cloud",
		baseUrl: state.cloudBaseUrl!,
		token: state.cloudToken!,
	});
}

function lockNavigationToOrigin(win: BrowserWindow, origin: string): void {
	const isAllowed = (url: string) => new URL(url).origin === origin;
	win.webContents.on("will-navigate", (event, url) => {
		if (!isAllowed(url)) {
			event.preventDefault();
		}
	});
	win.webContents.on("will-redirect", (event, url) => {
		if (!isAllowed(url)) {
			event.preventDefault();
		}
	});
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (isAllowed(url)) {
			return { action: "allow" };
		}
		return { action: "deny" };
	});
}

function lockNavigationToUrl(win: BrowserWindow, allowedUrl: string): void {
	const isAllowed = (url: string) => url === allowedUrl;
	win.webContents.on("will-navigate", (event, url) => {
		if (!isAllowed(url)) {
			event.preventDefault();
		}
	});
	win.webContents.on("will-redirect", (event, url) => {
		if (!isAllowed(url)) {
			event.preventDefault();
		}
	});
	win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function assertWindowOrigin(win: BrowserWindow, expectedOrigin: string): void {
	const actualUrl = win.webContents.getURL();
	const actualOrigin = new URL(actualUrl).origin;
	if (actualOrigin !== expectedOrigin) {
		throw new Error(
			`云端地址跳转到了不同来源：${actualOrigin}，请确认云端 URL 是否正确`,
		);
	}
}

async function injectCloudToken(win: BrowserWindow, token: string): Promise<void> {
	await win.webContents.executeJavaScript(
		`window.localStorage.setItem(${JSON.stringify(API_TOKEN_LOCAL_STORAGE_KEY)}, ${JSON.stringify(token)});
window.dispatchEvent(new Event(${JSON.stringify(AUTH_CHANGED_EVENT)}));`,
		true,
	);
}

async function openLocalApp(): Promise<{ mode: "local"; appUrl: string }> {
	const local = await ensureLocalCoreStarted();
	const win = replaceMainWindow("local");
	await win.loadURL(local.appUrl);
	createTray({ win, mode: "local", localBaseUrl: local.appUrl });
	writeModeState("local");
	updateApplicationMenu("local");
	return { mode: "local", appUrl: local.appUrl };
}

async function openCloudApp(): Promise<{ mode: "cloud"; cloudBaseUrl: string }> {
	const state = readConfiguredCloudState();
	const cloudBaseUrl = state.cloudBaseUrl!;
	const win = replaceMainWindow("cloud");
	const expectedOrigin = new URL(cloudBaseUrl).origin;
	lockNavigationToOrigin(win, expectedOrigin);
	await win.loadURL(cloudBaseUrl);
	assertWindowOrigin(win, expectedOrigin);
	await injectCloudToken(win, state.cloudToken!);
	createTray({ win, mode: "cloud", cloudBaseUrl });
	writeModeState("cloud");
	updateApplicationMenu("cloud");
	return { mode: "cloud", cloudBaseUrl };
}

async function openOnboarding(initialError?: string): Promise<void> {
	const win = replaceMainWindow("onboarding");
	currentOnboardingUrl = getOnboardingDataUrl(initialError);
	lockNavigationToUrl(win, currentOnboardingUrl);
	await win.loadURL(currentOnboardingUrl);
	createTray({ win, mode: "onboarding" });
	updateApplicationMenu("onboarding");
}

async function openApp(mode: "local" | "cloud"): Promise<unknown> {
	if (mode === "cloud") return openCloudApp();
	return openLocalApp();
}

async function useTemporaryLocal(): Promise<unknown> {
	const local = await ensureLocalCoreStarted();
	writeModeState("local", { defaultMode: null });
	return local;
}

async function reconnectFromMenu(): Promise<void> {
	writeElectronState(DEFAULT_ELECTRON_STATE);
	await openOnboarding("请重新连接 ChatCrystal。");
}

function getRedactedState(): ElectronOnboardingState {
	const state = readElectronState();
	return { ...state, cloudToken: redactToken(state.cloudToken) };
}

function registerIpcHandlers(): void {
	registerOnboardingIpc({
		getOnboardingOrigin: () => ONBOARDING_ORIGIN,
		getOnboardingUrl: () => currentOnboardingUrl,
		getState: getRedactedState,
		saveCloudConnection,
		startLocal: startLocalMode,
		importLocalHistory,
		uploadLocalHistory,
		testModel,
		summarizeBatch,
		getMcpSnippet,
		openApp,
		useTemporaryLocal,
	});
}

async function gracefulShutdown(): Promise<void> {
	console.log("[Electron] Shutting down...");
	if (serverShutdown) {
		await serverShutdown();
		serverShutdown = null;
	}
	destroyTray();
}

app.on("second-instance", () => {
	if (!mainWindow) return;
	if (mainWindow.isMinimized()) mainWindow.restore();
	mainWindow.show();
	mainWindow.focus();
});

app.on("before-quit", (event) => {
	if (isQuitting) return;

	event.preventDefault();
	isQuitting = true;
	const timeout = setTimeout(() => {
		console.error("[Electron] Shutdown timed out, forcing exit");
		app.exit(1);
	}, 10000);
	gracefulShutdown()
		.catch((err) => console.error("[Electron] Shutdown error:", err))
		.finally(() => {
			clearTimeout(timeout);
			app.quit();
		});
});

app.on("window-all-closed", () => {
	// Windows tray keeps the app alive.
});

app.whenReady().then(async () => {
	try {
		setRuntimeEnvironment();
		configureLocalContentSecurityPolicy();
		registerIpcHandlers();

		const state = readElectronState();
		if (state.defaultMode === "cloud" && state.cloudBaseUrl && state.cloudToken) {
			try {
				await openCloudApp();
				console.log(`[Electron] ChatCrystal cloud mode ready at ${state.cloudBaseUrl}`);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[Electron] Cloud mode startup failed:", err);
				await openOnboarding(`云端连接失败：${message}`);
			}
			return;
		}

		if (state.defaultMode === "local") {
			try {
				const local = await openLocalApp();
				console.log(`[Electron] ChatCrystal local mode ready at ${local.appUrl}`);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[Electron] Local mode startup failed:", err);
				await openOnboarding(`本地核心启动失败：${message}`);
			}
			return;
		}

		await openOnboarding();
		console.log("[Electron] ChatCrystal onboarding ready");
	} catch (err) {
		console.error("[Electron] Failed to start:", err);
		const message = err instanceof Error ? err.message : String(err);

		dialog.showErrorBox(
			"ChatCrystal failed to start",
			`An error occurred during startup:\n\n${message}\n\nPlease check the cloud URL, token, port availability, or data directory permissions.`,
		);
		app.quit();
	}
});
