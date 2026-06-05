import assert from "node:assert/strict";
import test from "node:test";
import { formatConnectionError } from "../network-errors.js";

test("connection errors explain that 0.0.0.0 is not a client address", () => {
	const message = formatConnectionError(
		"http://0.0.0.0:3722",
		new TypeError("fetch failed"),
		["10.1.86.91"],
	);

	assert.match(message, /0\.0\.0\.0/);
	assert.match(message, /服务端监听/);
	assert.match(message, /实际 IP/);
	assert.doesNotMatch(message, /127\.0\.0\.1/);
});

test("connection errors keep local LAN IP guidance aligned with cloud addressing", () => {
	const message = formatConnectionError(
		"http://10.1.86.91:3722",
		new TypeError("fetch failed"),
		["10.1.86.91"],
	);

	assert.match(message, /10\.1\.86\.91:3722/);
	assert.match(message, /Docker Desktop/);
	assert.match(message, /端口转发/);
	assert.match(message, /真实远程主机/);
	assert.doesNotMatch(message, /127\.0\.0\.1/);
});

test("connection errors keep remote-host guidance generic", () => {
	const message = formatConnectionError(
		"http://203.0.113.10:3722",
		new TypeError("fetch failed"),
		["10.1.86.91"],
	);

	assert.match(message, /203\.0\.113\.10:3722/);
	assert.match(message, /端口/);
	assert.doesNotMatch(message, /127\.0\.0\.1:3722/);
});
