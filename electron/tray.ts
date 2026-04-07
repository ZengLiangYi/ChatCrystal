import { type BrowserWindow, Menu, nativeImage, shell, Tray } from "electron";
import path from "path";

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
			label: "打开窗口",
			click: () => {
				win.show();
				win.focus();
			},
		},
		{
			label: "搜索知识库",
			click: () => {
				win.show();
				win.focus();
				const baseUrl = `http://localhost:${port}`;
				win.loadURL(`${baseUrl}/search`);
			},
		},
		{
			label: "在浏览器中打开",
			click: () => {
				shell.openExternal(`http://localhost:${port}`);
			},
		},
		{ type: "separator" },
		{
			label: "退出",
			click: () => {
				// Setting this before quit so the window close handler knows to actually quit
				(win as BrowserWindow & { isQuitting?: boolean }).isQuitting = true;
				require("electron").app.quit();
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
