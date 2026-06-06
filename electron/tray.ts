import { type BrowserWindow, Menu, nativeImage, shell, Tray } from "electron";
import path from "node:path";

let tray: Tray | null = null;

export type TrayOptions =
	| ({
			win: BrowserWindow;
			mode: "onboarding";
	  } & TrayActions)
	| ({
			win: BrowserWindow;
			mode: "local";
			localBaseUrl: string;
	  } & TrayActions)
	| ({
			win: BrowserWindow;
			mode: "cloud";
			cloudBaseUrl: string;
	  } & TrayActions);

type TrayActions = {
	showMainWindow: () => void;
	reconnect: () => Promise<void> | void;
	checkForUpdates: () => Promise<void> | void;
	quit: () => void;
};

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
			label: "显示 ChatCrystal",
			click: options.showMainWindow,
		},
		{
			label: "重新连接...",
			click: () => {
				void options.reconnect();
			},
		},
		{
			label: "检查更新...",
			click: () => {
				void options.checkForUpdates();
			},
		},
	];

	if (openTarget) {
		menuItems.push(
			{
				label: "搜索知识",
				click: () => {
					options.win.show();
					options.win.focus();
					options.win.loadURL(`${openTarget}/search`);
				},
			},
			{
				label: "在浏览器中打开",
				click: () => {
					shell.openExternal(openTarget);
				},
			},
		);
	}

	menuItems.push(
		{ type: "separator" },
		{
			label: "退出",
			click: options.quit,
		},
	);

	const contextMenu = Menu.buildFromTemplate(menuItems);

	tray.setContextMenu(contextMenu);

	// Double-click to show window
	tray.on("double-click", () => {
		options.showMainWindow();
	});

	return tray;
}

export function destroyTray(): void {
	if (tray) {
		tray.destroy();
		tray = null;
	}
}
