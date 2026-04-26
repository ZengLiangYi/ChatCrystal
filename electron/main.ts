import {
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, Menu, screen, session } from "electron";
import { createTray, destroyTray } from "./tray";

// --------------------------------------------------
// Single instance lock
// --------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
}

// --------------------------------------------------
// Remove default menu bar
// --------------------------------------------------
Menu.setApplicationMenu(null);

// --------------------------------------------------
// Window state persistence
// --------------------------------------------------
interface WindowState {
	x?: number;
	y?: number;
	width: number;
	height: number;
	isMaximized: boolean;
}

function getWindowStatePath(): string {
	return path.join(app.getPath("userData"), "window-state.json");
}

function loadWindowState(): WindowState {
	try {
		const data = readFileSync(getWindowStatePath(), "utf-8");
		return JSON.parse(data);
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
		// Ignore write errors
	}
}

// Store last non-maximized bounds separately (avoids `any` cast on BrowserWindow)
let lastNormalBounds: Electron.Rectangle | null = null;

// --------------------------------------------------
// State
// --------------------------------------------------
let mainWindow: BrowserWindow | null = null;
let serverShutdown: (() => Promise<void>) | null = null;
let isQuitting = false;
let serverPort = 3721;

// --------------------------------------------------
// Port detection: try preferred port, fall back to random
// --------------------------------------------------
function findFreePort(preferred: number): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(preferred, "127.0.0.1", () => {
			srv.close(() => resolve(preferred));
		});
		srv.on("error", () => {
			// Preferred port occupied, use random
			const srv2 = net.createServer();
			srv2.listen(0, "127.0.0.1", () => {
				const port = (srv2.address() as net.AddressInfo).port;
				srv2.close(() => resolve(port));
			});
			srv2.on("error", (err) => {
				reject(new Error(`Cannot find a free port: ${err.message}`));
			});
		});
	});
}

// --------------------------------------------------
// Create main window
// --------------------------------------------------
function createWindow(): BrowserWindow {
	const state = loadWindowState();

	// S-1: Validate saved position against current screen bounds
	// If window would be off-screen (e.g., external monitor disconnected), reset position
	if (state.x !== undefined && state.y !== undefined) {
		const displays = screen.getAllDisplays();
		const visible = displays.some((d) => {
			const b = d.bounds;
			return (
				state.x! >= b.x - 50 &&
				state.x! < b.x + b.width &&
				state.y! >= b.y - 50 &&
				state.y! < b.y + b.height
			);
		});
		if (!visible) {
			state.x = undefined;
			state.y = undefined;
		}
	}

	// I-3: icon path — __dirname is electron/dist/ in both dev and packaged
	const iconPath = path.join(__dirname, "..", "icon.png");
	const win = new BrowserWindow({
		width: state.width,
		height: state.height,
		x: state.x,
		y: state.y,
		minWidth: 900,
		minHeight: 600,
		show: false,
		title: "ChatCrystal",
		icon: iconPath,
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true, // I-6: explicit sandbox
		},
	});

	if (state.isMaximized) {
		win.maximize();
	}

	// Track restore bounds for maximized state
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

	// Show when ready to avoid flash
	win.once("ready-to-show", () => {
		win.show();
	});

	// Close → save state + hide to tray (unless quitting)
	win.on("close", (e) => {
		saveWindowState(win);
		if (!isQuitting) {
			e.preventDefault();
			win.hide();
		}
	});

	return win;
}

// --------------------------------------------------
// Graceful shutdown
// --------------------------------------------------
async function gracefulShutdown(): Promise<void> {
	console.log("[Electron] Shutting down...");
	if (serverShutdown) {
		await serverShutdown();
		serverShutdown = null;
	}
	destroyTray();
}

// --------------------------------------------------
// App lifecycle
// --------------------------------------------------
app.on("second-instance", () => {
	if (mainWindow) {
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.show();
		mainWindow.focus();
	}
});

app.on("before-quit", (e) => {
	if (!isQuitting) {
		e.preventDefault();
		isQuitting = true;
		// I-1: timeout prevents infinite hang if shutdown gets stuck
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
	}
});

app.on("window-all-closed", () => {
	// On Windows, don't quit when all windows closed (tray keeps running)
	// This is handled by the close → hide logic above
});

// --------------------------------------------------
// Data directory
// --------------------------------------------------
function getDataDir(): string {
	if (process.env.DATA_DIR) {
		return path.isAbsolute(process.env.DATA_DIR)
			? process.env.DATA_DIR
			: path.resolve(app.getAppPath(), process.env.DATA_DIR);
	}

	return path.join(homedir(), ".chatcrystal", "data");
}

// --------------------------------------------------
// Server startup with retry
// --------------------------------------------------
async function startServer(port: number): Promise<{
	shutdown: () => Promise<void>;
}> {
	const serverEntry = pathToFileURL(
		path.join(app.getAppPath(), "server", "dist", "server", "src", "index.js"),
	).href;
	// C-1: Function() constructor is used intentionally to bypass Electron's CJS
	// bundler restrictions on dynamic import(). This is a known workaround for
	// loading ESM server modules from a CJS main process. Replace with direct
	// import() if the Electron main process is ever migrated to ESM.
	const serverModule = (await Function(
		"specifier",
		"return import(specifier)",
	)(serverEntry)) as {
		createServer: (opts?: { port?: number; host?: string }) => Promise<{
			app: unknown;
			port: number;
			shutdown: () => Promise<void>;
		}>;
	};
	return serverModule.createServer({ port, host: "127.0.0.1" });
}

// --------------------------------------------------
// App lifecycle
// --------------------------------------------------
app.whenReady().then(async () => {
	try {
		// 1. Determine data directory
		const dataDir = getDataDir();

		// 2. Ensure data directory exists
		mkdirSync(dataDir, { recursive: true });

		// 3. Set environment variables for the server
		process.env.ELECTRON = "true";
		process.env.DATA_DIR = dataDir;
		if (app.isPackaged) {
			process.env.ELECTRON_PACKAGED = "true";
		}

		// 4. Set Content Security Policy (C-2)
		// Restricts script execution to prevent XSS from rendered AI conversation content.
		// Skipped in dev mode — Vite's HMR injects inline scripts incompatible with strict CSP.
		if (!process.env.VITE_DEV_URL) {
			session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
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

		// 5. Find free port
		serverPort = await findFreePort(3721);
		if (serverPort !== 3721) {
			console.log(`[Electron] Port 3721 occupied, using port ${serverPort}`);
		}

		// 6. Start the Fastify server (skip in dev — server runs separately via tsx)
		const devUrl = process.env.VITE_DEV_URL;
		if (!devUrl) {
			const server = await startServer(serverPort);
			serverShutdown = server.shutdown;
		}

		// 7. Create window
		mainWindow = createWindow();

		// 8. Load the app
		const url = devUrl || `http://localhost:${serverPort}`;
		await mainWindow.loadURL(url);

		// 9. Create tray
		createTray(mainWindow, serverPort);

		console.log(`[Electron] ChatCrystal ready at ${url}`);
	} catch (err) {
		console.error("[Electron] Failed to start:", err);
		const message = err instanceof Error ? err.message : String(err);

		dialog.showErrorBox(
			"ChatCrystal failed to start",
			`An error occurred during startup:\n\n${message}\n\nPlease check if the port is in use or data directory permissions.`,
		);
		app.quit();
	}
});
