import assert from "node:assert/strict";
import test from "node:test";
import { buildApplicationMenuTemplate } from "../app-menu.js";

const actions = {
	showMainWindow: () => undefined,
	reconnect: async () => undefined,
	quit: () => undefined,
};

test("application menu exposes reconnect in every mode", () => {
	for (const mode of ["local", "cloud", "onboarding"] as const) {
		const template = buildApplicationMenuTemplate(mode, actions);

		assert.ok(template);
		const chatCrystalMenu = template.find((item) => item.label === "ChatCrystal");
		assert.ok(chatCrystalMenu);
		const submenu = chatCrystalMenu.submenu;
		assert.ok(Array.isArray(submenu));
		assert.equal(
			submenu.some((item) => "label" in item && item.label === "重新连接..."),
			true,
		);
	}
});
