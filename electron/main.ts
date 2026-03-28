import { app, BrowserWindow } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import net from 'net';
import { createTray, destroyTray } from './tray';

// --------------------------------------------------
// Single instance lock
// --------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

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
    srv.listen(preferred, '127.0.0.1', () => {
      srv.close(() => resolve(preferred));
    });
    srv.on('error', () => {
      // Preferred port occupied, use random
      const srv2 = net.createServer();
      srv2.listen(0, '127.0.0.1', () => {
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
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'ChatCrystal',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Hide menu bar
  win.setMenuBarVisibility(false);

  // Show when ready to avoid flash
  win.once('ready-to-show', () => {
    win.show();
  });

  // Close → hide to tray (unless quitting)
  win.on('close', (e) => {
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
  console.log('[Electron] Shutting down...');
  if (serverShutdown) {
    await serverShutdown();
    serverShutdown = null;
  }
  destroyTray();
}

// --------------------------------------------------
// App lifecycle
// --------------------------------------------------
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', async (e) => {
  if (!isQuitting) {
    e.preventDefault();
    isQuitting = true;
    await gracefulShutdown();
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // On Windows, don't quit when all windows closed (tray keeps running)
  // This is handled by the close → hide logic above
});

app.whenReady().then(async () => {
  try {
    // 1. Determine data directory
    const dataDir = app.isPackaged
      ? path.join(app.getPath('userData'), 'data')
      : path.join(app.getAppPath(), 'data');

    // 2. Set environment variables for the server
    process.env.ELECTRON = 'true';
    process.env.DATA_DIR = dataDir;
    if (app.isPackaged) {
      process.env.ELECTRON_PACKAGED = 'true';
    }

    // 3. Find free port
    serverPort = await findFreePort(3721);
    console.log(`[Electron] Using port ${serverPort}`);

    // 4. Start the Fastify server (skip in dev — server runs separately via tsx)
    const devUrl = process.env.VITE_DEV_URL;
    if (!devUrl) {
      // Production mode: import server ESM module via file:// URL (required on Windows)
      const serverEntry = pathToFileURL(path.join(app.getAppPath(), 'server', 'dist', 'server', 'src', 'index.js')).href;
      const serverModule = await (Function('specifier', 'return import(specifier)')(serverEntry)) as {
        createServer: (opts?: { port?: number; host?: string }) => Promise<{
          app: unknown;
          port: number;
          shutdown: () => Promise<void>;
        }>;
      };
      const server = await serverModule.createServer({ port: serverPort, host: '127.0.0.1' });
      serverShutdown = server.shutdown;
    }

    // 5. Create window
    mainWindow = createWindow();

    // 6. Load the app
    const url = devUrl || `http://localhost:${serverPort}`;
    await mainWindow.loadURL(url);

    // 7. Create tray
    createTray(mainWindow, serverPort);

    console.log(`[Electron] ChatCrystal ready at ${url}`);
  } catch (err) {
    console.error('[Electron] Failed to start:', err);
    app.quit();
  }
});
