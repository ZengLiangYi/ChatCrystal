import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, Menu } from "electron";
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
	return new Promise((resolve) => {
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
		});
	});
}

// --------------------------------------------------
// Create main window
// --------------------------------------------------
function createWindow(): BrowserWindow {
	const state = loadWindowState();

	const iconPath = path.join(__dirname, "..", "electron", "icon.png");
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

app.on("before-quit", async (e) => {
	if (!isQuitting) {
		e.preventDefault();
		isQuitting = true;
		await gracefulShutdown();
		app.quit();
	}
});

app.on("window-all-closed", () => {
	// On Windows, don't quit when all windows closed (tray keeps running)
	// This is handled by the close → hide logic above
});

// --------------------------------------------------
// Data migration: copy old project data/ to userData/data on first launch
// --------------------------------------------------
function migrateOldData(dataDir: string): void {
	if (existsSync(dataDir)) return; // Already has data, skip

	const oldDataDir = path.join(app.getAppPath(), "data");
	// In packaged mode, check the original install location's parent
	const candidatePaths = [
		oldDataDir,
		path.resolve(app.getAppPath(), "../../data"), // next to the installed app
	];

	for (const candidate of candidatePaths) {
		const dbFile = path.join(candidate, "chatcrystal.db");
		if (existsSync(dbFile)) {
			console.log(`[Electron] Migrating data from ${candidate} to ${dataDir}`);
			try {
				cpSync(candidate, dataDir, { recursive: true });
				console.log("[Electron] Data migration complete");
			} catch (err) {
				console.warn("[Electron] Data migration failed:", err);
			}
			return;
		}
	}
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
		const dataDir = app.isPackaged
			? path.join(app.getPath("userData"), "data")
			: path.join(app.getAppPath(), "data");

		// 2. Migrate old data if this is first packaged launch
		if (app.isPackaged) {
			migrateOldData(dataDir);
		}

		// 3. Ensure data directory exists
		mkdirSync(dataDir, { recursive: true });

		// 4. Set environment variables for the server
		process.env.ELECTRON = "true";
		process.env.DATA_DIR = dataDir;
		if (app.isPackaged) {
			process.env.ELECTRON_PACKAGED = "true";
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
			"ChatCrystal 启动失败",
			`应用启动时遇到错误：\n\n${message}\n\n请检查端口是否被占用或数据目录权限。`,
		);
		app.quit();
	}
});
