import { app, type BrowserWindow, Menu, nativeImage, shell, Tray } from "electron";
import path from "node:path";

let tray: Tray | null = null;

export function createTray(win: BrowserWindow, port: number): Tray {
	// Use icon from electron directory
	const iconPath = path.join(__dirname, "..", "icon.png");
	const icon = nativeImage
		.createFromPath(iconPath)
		.resize({ width: 16, height: 16 });

	tray = new Tray(icon);
	tray.setToolTip("ChatCrystal");

	const contextMenu = Menu.buildFromTemplate([
		{
			label: "ChatCrystal",
			enabled: false,
		},
		{ type: "separator" },
		{
			label: "Open Window",
			click: () => {
				win.show();
				win.focus();
			},
		},
		{
			label: "Search Knowledge",
			click: () => {
				win.show();
				win.focus();
				const baseUrl = `http://localhost:${port}`;
				win.loadURL(`${baseUrl}/search`);
			},
		},
		{
			label: "Open in Browser",
			click: () => {
				shell.openExternal(`http://localhost:${port}`);
			},
		},
		{ type: "separator" },
		{
			label: "Quit",
			click: () => {
				// I-5: app.quit() triggers before-quit which sets isQuitting in main.ts
				app.quit();
			},
		},
	]);

	tray.setContextMenu(contextMenu);

	// Double-click to show window
	tray.on("double-click", () => {
		win.show();
		win.focus();
	});

	return tray;
}

export function destroyTray(): void {
	if (tray) {
		tray.destroy();
		tray = null;
	}
}
