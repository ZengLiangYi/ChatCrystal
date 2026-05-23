import { app, type BrowserWindow, Menu, nativeImage, shell, Tray } from "electron";
import path from "node:path";

let tray: Tray | null = null;

export type TrayOptions =
	| { win: BrowserWindow; mode: "onboarding" }
	| { win: BrowserWindow; mode: "local"; localBaseUrl: string }
	| { win: BrowserWindow; mode: "cloud"; cloudBaseUrl: string };

export function createTray(options: TrayOptions): Tray {
	if (tray) {
		tray.destroy();
		tray = null;
	}

	// Use icon from electron directory
	const iconPath = path.join(__dirname, "..", "icon.png");
	const icon = nativeImage
		.createFromPath(iconPath)
		.resize({ width: 16, height: 16 });

	tray = new Tray(icon);
	tray.setToolTip("ChatCrystal");

	const openTarget =
		options.mode === "cloud"
			? options.cloudBaseUrl
			: options.mode === "local"
				? options.localBaseUrl
				: null;

	const menuItems: Electron.MenuItemConstructorOptions[] = [
		{
			label: "ChatCrystal",
			enabled: false,
		},
		{ type: "separator" },
		{
			label: "Open Window",
			click: () => {
				options.win.show();
				options.win.focus();
			},
		},
	];

	if (openTarget) {
		menuItems.push(
			{
				label: "Search Knowledge",
				click: () => {
					options.win.show();
					options.win.focus();
					options.win.loadURL(`${openTarget}/search`);
				},
			},
			{
				label: "Open in Browser",
				click: () => {
					shell.openExternal(openTarget);
				},
			},
		);
	}

	menuItems.push(
		{ type: "separator" },
		{
			label: "Quit",
			click: () => {
				// I-5: app.quit() triggers before-quit which sets isQuitting in main.ts
				app.quit();
			},
		},
	);

	const contextMenu = Menu.buildFromTemplate(menuItems);

	tray.setContextMenu(contextMenu);

	// Double-click to show window
	tray.on("double-click", () => {
		options.win.show();
		options.win.focus();
	});

	return tray;
}

export function destroyTray(): void {
	if (tray) {
		tray.destroy();
		tray = null;
	}
}
