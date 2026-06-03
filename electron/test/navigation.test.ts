import assert from "node:assert/strict";
import test from "node:test";
import { isExternalBrowserUrl } from "../navigation.js";

test("external browser navigation identifies links outside the app origin", () => {
	assert.equal(
		isExternalBrowserUrl(
			"https://github.com/ZengLiangYi/ChatCrystal",
			"http://localhost:13721",
		),
		true,
	);
	assert.equal(
		isExternalBrowserUrl(
			"http://localhost:13721/search",
			"http://localhost:13721",
		),
		false,
	);
	assert.equal(
		isExternalBrowserUrl(
			"https://chatcrystal.example.com/search",
			"https://chatcrystal.example.com",
		),
		false,
	);
});

test("external browser navigation ignores non-http protocols", () => {
	assert.equal(isExternalBrowserUrl("mailto:hello@example.com", "http://localhost:13721"), false);
	assert.equal(isExternalBrowserUrl("not a url", "http://localhost:13721"), false);
});
