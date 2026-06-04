import type { MenuItemConstructorOptions } from "electron";

export type ApplicationMenuMode = "onboarding" | "local" | "cloud";
export type ApplicationMenuActions = {
	showMainWindow: () => void;
	reconnect: () => Promise<void> | void;
	quit: () => void;
};

function buildChatCrystalMenu(
	actions?: ApplicationMenuActions,
): MenuItemConstructorOptions {
	const appActions: MenuItemConstructorOptions[] = [
		{
			label: "显示 ChatCrystal",
			click: actions?.showMainWindow,
		},
		{
			label: "重新连接...",
			click: () => {
				void actions?.reconnect();
			},
		},
		{ type: "separator" },
	];

	if (process.platform === "darwin") {
		return {
			label: "ChatCrystal",
			submenu: [
				{ role: "about" },
				{ type: "separator" },
				...appActions,
				{ role: "services" },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{ role: "quit" },
			],
		};
	}

	return {
		label: "ChatCrystal",
		submenu: [
			...appActions,
			{
				label: "退出",
				click: actions?.quit,
			},
		],
	};
}

export function buildApplicationMenuTemplate(
	_mode: ApplicationMenuMode,
	actions?: ApplicationMenuActions,
): MenuItemConstructorOptions[] {
	const template: MenuItemConstructorOptions[] = [
		buildChatCrystalMenu(actions),
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
		{
			label: "View",
			submenu: [
				{ role: "reload" },
				{ role: "forceReload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{
			label: "Window",
			submenu: [
				{ role: "minimize" },
				{ role: "close" },
			],
		},
	];

	return template;
}
