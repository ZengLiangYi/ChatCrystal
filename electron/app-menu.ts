import type { MenuItemConstructorOptions } from "electron";

export type ApplicationMenuMode = "onboarding" | "local" | "cloud";

export type ApplicationMenuActions = {
	showMainWindow: () => void;
	reconnect: () => Promise<void> | void;
	quit: () => void;
};

export function buildApplicationMenuTemplate(
	_mode: ApplicationMenuMode,
	actions: ApplicationMenuActions,
): MenuItemConstructorOptions[] {
	return [
		{
			label: "ChatCrystal",
			submenu: [
				{
					label: "显示 ChatCrystal",
					click: actions.showMainWindow,
				},
				{ type: "separator" },
				{
					label: "重新连接...",
					click: () => {
						void actions.reconnect();
					},
				},
				{ type: "separator" },
				{
					label: "退出",
					click: actions.quit,
				},
			],
		},
	];
}
