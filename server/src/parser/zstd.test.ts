import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { zstdCompressSync } from "node:zlib";
import {
	decompressZstdFrames,
	isZstd,
	readMaybeZstdFile,
} from "./zstd.js";

function frame(text: string): Buffer {
	return zstdCompressSync(Buffer.from(text, "utf8"));
}

let root = "";

function fixtureDir(): string {
	if (!root) root = mkdtempSync(join(tmpdir(), "chatcrystal-zstd-"));
	return root;
}

test.after(() => {
	if (root) rmSync(root, { recursive: true, force: true });
});

test("isZstd recognizes the frame magic and rejects plain buffers", () => {
	assert.equal(isZstd(Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00])), true);
	assert.equal(isZstd(frame("hello")), true);
	assert.equal(isZstd(Buffer.from("{\"type\":\"message\"}\n")), false);
	assert.equal(isZstd(Buffer.alloc(0)), false);
	assert.equal(isZstd(Buffer.from([0x28, 0xb5, 0x2f])), false);
});

test("decompressZstdFrames returns plain buffers unchanged", () => {
	const plain = Buffer.from('{"type":"message"}\n{"type":"message"}\n');
	assert.deepEqual(decompressZstdFrames(plain), plain);
	assert.equal(decompressZstdFrames(Buffer.alloc(0)).length, 0);
});

test("decompressZstdFrames joins every frame of a multi-frame buffer", () => {
	// dsh appends one zstd frame per write batch; Node alone only decodes the first.
	const text = '{"type":"user/message","seq":1,"data":{}}\n';
	const buffer = Buffer.concat([
		frame(text),
		frame(text),
		frame('{"type":"assistant/message","seq":2,"data":{}}\n'),
	]);

	assert.equal(
		decompressZstdFrames(buffer).toString("utf8"),
		`${text}${text}{"type":"assistant/message","seq":2,"data":{}}\n`,
	);
});

test("decompressZstdFrames handles many small frames and empty frames", () => {
	const lines = Array.from({ length: 64 }, (_, i) => `{"seq":${i}}`);
	const buffer = Buffer.concat([
		frame(""),
		...lines.map((line) => frame(`${line}\n`)),
		frame(""),
	]);

	const decoded = decompressZstdFrames(buffer).toString("utf8");
	assert.deepEqual(
		decoded.split("\n").filter(Boolean),
		lines,
	);
});

test("decompressZstdFrames skips a false frame magic in the payload prefix", () => {
	// A magic number that is not a frame start must not swallow the real frames.
	const junk = Buffer.concat([
		Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
		Buffer.from("this is not a zstd frame"),
	]);
	const valid = Buffer.concat([frame("one\n"), frame("two\n")]);

	const decoded = decompressZstdFrames(Buffer.concat([junk, valid])).toString(
		"utf8",
	);
	assert.equal(decoded, "one\ntwo\n");
});

test("decompressZstdFrames recovers the complete frames of a truncated log", () => {
	const complete = Buffer.concat([frame("first\n"), frame("second\n")]);
	const truncatedTail = frame("third line that never finished writing\n").subarray(
		0,
		12,
	);

	const decoded = decompressZstdFrames(
		Buffer.concat([complete, truncatedTail]),
	).toString("utf8");
	assert.ok(decoded.startsWith("first\nsecond\n"), `got: ${decoded}`);
});

test("readMaybeZstdFile reads multi-frame zstd files and plain files", async () => {
	const dir = fixtureDir();

	const plainPath = join(dir, "plain.jsonl");
	writeFileSync(plainPath, '{"a":1}\n{"b":2}\n');
	assert.equal(await readMaybeZstdFile(plainPath), '{"a":1}\n{"b":2}\n');

	const zstdPath = join(dir, "session.v4.jsonl.zstd");
	writeFileSync(
		zstdPath,
		Buffer.concat([
			frame('{"type":"session","version":4,"cwd":"/tmp/project"}\n'),
			frame('{"type":"user/message","seq":1,"data":{}}\n'),
		]),
	);
	assert.equal(
		await readMaybeZstdFile(zstdPath),
		'{"type":"session","version":4,"cwd":"/tmp/project"}\n{"type":"user/message","seq":1,"data":{}}\n',
	);

	const emptyPath = join(dir, "empty.jsonl");
	writeFileSync(emptyPath, "");
	assert.equal(await readMaybeZstdFile(emptyPath), "");
});
