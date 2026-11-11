import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

// appConfig resolves its data dirs when the config module is first imported, so
// the fixture roots have to be in the environment before that. Each test then
// points appConfig at its own temporary data dirs.
const baseDir = mkdtempSync(join(tmpdir(), "chatcrystal-workbuddy-"));
process.env.WORKBUDDY_DATA_DIR = baseDir;
process.env.WORKBUDDY_AI_DATA_DIR = baseDir;
// A real WSL distro may be running on this machine; keep it out of the tests.
process.env.CHATCRYSTAL_WSL = "0";

const { appConfig } = await import("../../config.js");
const { workbuddyAdapter } = await import("./workbuddy.js");
const { setWslHomesForTesting } = await import("../wsl.js");

const SESSION_ID = "c8501950-55c4-47a0-b98e-898a62990875";
const CWD = "c:\\Users\\me\\repo\\demo";
const BASE_TIME = 1793765860947;

function useRoots(): { primary: string; ai: string } {
	const primary = mkdtempSync(join(baseDir, "data-"));
	const ai = mkdtempSync(join(baseDir, "data-ai-"));
	appConfig.workbuddyDataDir = primary;
	appConfig.workbuddyAiDataDir = ai;
	return { primary, ai };
}

function writeSession(options: {
	root: string;
	project: string;
	sessionId: string;
	fileName?: string;
	lines: string[];
}): string {
	const projectPath = join(options.root, "projects", options.project);
	const filePath = join(projectPath, `${options.fileName ?? options.sessionId}.jsonl`);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${options.lines.join("\n")}\n`);
	return filePath;
}

function sessionMetaLine(sessionId = SESSION_ID): string {
	return JSON.stringify({
		type: "session-meta",
		id: "01a1a4c6-fc84-794b-b575-a9b8cd6a4526",
		sessionId,
		timestamp: BASE_TIME - 1000,
		meta: { "codebuddy.ai/hostKind": "unopted" },
	});
}

test.after(() => {
	setWslHomesForTesting(null);
	rmSync(baseDir, { recursive: true, force: true });
});

test("detect returns null when no data dir has sessions", async () => {
	appConfig.workbuddyDataDir = join(baseDir, "missing-data");
	appConfig.workbuddyAiDataDir = join(baseDir, "missing-ai");
	assert.equal(await workbuddyAdapter.detect(), null);

	// A data root without a projects/ folder is not a source either.
	useRoots();
	assert.equal(await workbuddyAdapter.detect(), null);
});

test("detect merges both builds and reports their session count", async () => {
	const { primary, ai } = useRoots();
	writeSession({
		root: primary,
		project: "c-Users-me-repo-demo",
		sessionId: SESSION_ID,
		lines: [sessionMetaLine()],
	});
	writeSession({
		root: primary,
		project: "c-Users-me-repo-other",
		sessionId: "session-two",
		lines: [sessionMetaLine("session-two")],
	});
	writeSession({
		root: ai,
		project: "c-Users-me-repo-ai",
		sessionId: "session-ai",
		lines: [sessionMetaLine("session-ai")],
	});

	const info = await workbuddyAdapter.detect();
	assert.ok(info);
	assert.equal(info.name, "workbuddy");
	assert.equal(info.displayName, "WorkBuddy");
	assert.equal(info.dataDir, primary);
	assert.equal(info.conversationCount, 3);
});

test("detect falls back to the WorkBuddy AI root when it is the only one", async () => {
	const { ai } = useRoots();
	appConfig.workbuddyDataDir = join(baseDir, "missing-data");
	writeSession({
		root: ai,
		project: "c-Users-me-repo-ai",
		sessionId: "session-ai",
		lines: [sessionMetaLine("session-ai")],
	});

	const info = await workbuddyAdapter.detect();
	assert.ok(info);
	assert.equal(info.dataDir, ai);
	assert.equal(info.conversationCount, 1);
});

test("scan returns session ids, skips subagent files and ignores non-jsonl side files", async () => {
	const { primary, ai } = useRoots();
	const mainPath = writeSession({
		root: primary,
		project: "c-Users-me-repo-demo",
		sessionId: SESSION_ID,
		lines: [sessionMetaLine()],
	});
	// Subagent transcripts live one level deeper and are not conversations.
	writeSession({
		root: primary,
		project: "c-Users-me-repo-demo",
		sessionId: SESSION_ID,
		fileName: `${SESSION_ID}/subagents/agent-1`,
		lines: [sessionMetaLine()],
	});
	// Side files share the session id but are not .jsonl.
	writeFileSync(
		join(primary, "projects", "c-Users-me-repo-demo", `${SESSION_ID}.meta.json`),
		JSON.stringify({ cwd: CWD }),
	);
	writeFileSync(
		join(
			primary,
			"projects",
			"c-Users-me-repo-demo",
			`${SESSION_ID}.file-rollback.ndjson`,
		),
		"{}\n",
	);
	// The file name normally equals the sessionId; the id inside the file wins.
	const renamedPath = writeSession({
		root: ai,
		project: "c-Users-me-repo-ai",
		sessionId: "inner-session-id",
		fileName: "renamed-file",
		lines: [sessionMetaLine("inner-session-id")],
	});

	const metas = await workbuddyAdapter.scan();
	assert.equal(metas.length, 2);

	const primaryMeta = metas.find((meta) => meta.id === SESSION_ID);
	assert.ok(primaryMeta);
	assert.equal(primaryMeta.source, "workbuddy");
	assert.equal(primaryMeta.filePath, mainPath);
	assert.ok(primaryMeta.fileSize > 0);
	assert.ok(!Number.isNaN(Date.parse(primaryMeta.fileMtime)));

	const aiMeta = metas.find((meta) => meta.id === "inner-session-id");
	assert.ok(aiMeta);
	assert.equal(aiMeta.filePath, renamedPath);
});

test("parse reconstructs messages, cleans injected context and marks tool use", async () => {
	const { primary } = useRoots();
	writeSession({
		root: primary,
		project: "c-Users-me-repo-demo",
		sessionId: SESSION_ID,
		lines: [
			sessionMetaLine(),
			JSON.stringify({
				timestamp: BASE_TIME,
				type: "file-history-snapshot",
				cwd: CWD,
			}),
			JSON.stringify({
				id: "m-user-1",
				timestamp: BASE_TIME + 100,
				type: "message",
				role: "user",
				content: [
					{
						type: "input_text",
						text: [
							'<system-reminder data-role="user-context">',
							"<user_info>",
							"OS Version: win32",
							"</user_info>",
							"</system-reminder>",
							'<system-reminder data-role="additional-data">',
							"<current_time>now</current_time>",
							"</system-reminder>",
							"<user_query>Refactor the parser</user_query>",
						].join("\n"),
					},
				],
				cwd: CWD,
			}),
			// A framework notice in a user item: not something the person typed.
			JSON.stringify({
				id: "m-injected",
				timestamp: BASE_TIME + 150,
				type: "message",
				role: "user",
				content: [
					{
						type: "input_text",
						text: '<system-reminder data-role="user-context">only injected context</system-reminder>',
					},
				],
				cwd: CWD,
			}),
			JSON.stringify({
				id: "m-injected-2",
				timestamp: BASE_TIME + 160,
				type: "message",
				role: "user",
				content: [
					{
						type: "input_text",
						text: '<teammate-message teammate_id="probe">subagent report</teammate-message>',
					},
				],
				cwd: CWD,
			}),
			JSON.stringify({
				id: "m-reasoning-1",
				parentId: "m-user-1",
				timestamp: BASE_TIME + 200,
				type: "reasoning",
				content: [],
				rawContent: [
					{ type: "reasoning_text", text: "Inspect the parser first." },
				],
				cwd: CWD,
			}),
			JSON.stringify({
				id: "m-assistant-1",
				timestamp: BASE_TIME + 300,
				type: "message",
				role: "assistant",
				content: [
					{
						type: "output_text",
						text: "Here is the plan:\n```ts\nconst a = 1;\n```",
					},
				],
				cwd: CWD,
			}),
			JSON.stringify({
				id: "m-call-1",
				timestamp: BASE_TIME + 400,
				type: "function_call",
				name: "Read",
				arguments: "{}",
				cwd: CWD,
			}),
			JSON.stringify({
				id: "m-result-1",
				timestamp: BASE_TIME + 500,
				type: "function_call_result",
				output: "file contents",
				cwd: CWD,
			}),
			JSON.stringify({
				id: "m-reasoning-2",
				timestamp: BASE_TIME + 600,
				type: "reasoning",
				rawContent: [{ type: "reasoning_text", text: "Now write the patch." }],
				cwd: CWD,
			}),
			JSON.stringify({
				id: "m-title-ai",
				timestamp: BASE_TIME + 700,
				type: "ai-title",
				aiTitle: "Parser refactor plan",
				cwd: CWD,
			}),
			JSON.stringify({
				id: "m-title-custom",
				timestamp: BASE_TIME + 710,
				type: "custom-title",
				customTitle: "Refactor parser cleanly",
				cwd: CWD,
			}),
			JSON.stringify({
				id: "m-user-2",
				timestamp: BASE_TIME + 800,
				type: "message",
				role: "user",
				content: [
					{
						type: "input_text",
						text: "Looks good, apply it.\n@scene:code-editor",
					},
				],
				cwd: CWD,
			}),
			JSON.stringify({
				id: "m-assistant-2",
				timestamp: BASE_TIME + 900,
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "Patch applied." }],
				cwd: CWD,
			}),
			'{"id":"m-truncated","timestamp":179376586',
		],
	});

	const meta = (await workbuddyAdapter.scan())[0];
	assert.ok(meta);
	const parsed = await workbuddyAdapter.parse(meta);

	assert.equal(parsed.id, SESSION_ID);
	assert.equal(parsed.source, "workbuddy");
	assert.equal(parsed.cwd, CWD);
	assert.equal(parsed.projectDir, CWD);
	assert.equal(parsed.projectName, "demo");
	// A user-set title wins over the generated one.
	assert.equal(parsed.slug, "Refactor parser cleanly");
	assert.equal(parsed.gitBranch, null);

	assert.deepEqual(
		parsed.messages.map((message) => message.type),
		["user", "assistant", "user", "assistant"],
	);

	const [firstUser, firstAssistant, secondUser, secondAssistant] = parsed.messages;
	assert.ok(firstUser && firstAssistant && secondUser && secondAssistant);

	assert.equal(firstUser.id, "m-user-1");
	assert.equal(firstUser.content, "Refactor the parser");
	assert.equal(firstUser.timestamp, new Date(BASE_TIME + 100).toISOString());

	assert.equal(firstAssistant.id, "m-assistant-1");
	assert.equal(
		firstAssistant.content,
		"Here is the plan:\n```ts\nconst a = 1;\n```",
	);
	assert.equal(firstAssistant.thinking, "Inspect the parser first.");
	assert.equal(firstAssistant.hasToolUse, true);
	assert.equal(firstAssistant.hasCode, true);

	assert.equal(secondUser.content, "Looks good, apply it.");
	assert.equal(secondAssistant.content, "Patch applied.");
	assert.equal(secondAssistant.thinking, "Now write the patch.");
	assert.equal(secondAssistant.hasToolUse, false);

	assert.equal(parsed.firstMessageAt, new Date(BASE_TIME + 100).toISOString());
	assert.equal(parsed.lastMessageAt, new Date(BASE_TIME + 900).toISOString());
});

test("parse skips a session without conversation records", async () => {
	const { primary } = useRoots();
	writeSession({
		root: primary,
		project: "c-Users-me-empty",
		sessionId: "empty-session",
		lines: [sessionMetaLine("empty-session")],
	});

	const meta = (await workbuddyAdapter.scan())[0];
	assert.ok(meta);
	const parsed = await workbuddyAdapter.parse(meta);
	assert.deepEqual(parsed.messages, []);
	assert.equal(parsed.slug, null);
	assert.equal(parsed.cwd, null);
	assert.ok(parsed.firstMessageAt);
});

test("watchPaths targets both builds' project folders", () => {
	const { primary, ai } = useRoots();
	assert.deepEqual(workbuddyAdapter.watchPaths?.(), [
		resolve(primary, "projects", "**", "*.jsonl"),
		resolve(ai, "projects", "**", "*.jsonl"),
	]);
});

test("scans and parses sessions from both builds' WSL homes", async () => {
	const { primary, ai } = useRoots();
	// A local session keeps detect's dataDir on the Windows primary build.
	writeSession({
		root: primary,
		project: "c-Users-me-local",
		sessionId: "local-session",
		lines: [sessionMetaLine("local-session")],
	});

	const wslHome = mkdtempSync(join(baseDir, "wsl-home-"));
	const wslPrimary = join(wslHome, ".workbuddy");
	const wslAi = join(wslHome, ".workbuddy-ai");
	const wslMainPath = writeSession({
		root: wslPrimary,
		project: "c-Users-me-wsl",
		sessionId: "wsl-session",
		lines: [
			sessionMetaLine("wsl-session"),
			JSON.stringify({
				id: "wsl-u1",
				timestamp: BASE_TIME,
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "WSL question" }],
				cwd: "/home/me/wsl-app",
			}),
			JSON.stringify({
				id: "wsl-a1",
				timestamp: BASE_TIME + 100,
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "WSL answer" }],
				cwd: "/home/me/wsl-app",
			}),
		],
	});
	const wslAiPath = writeSession({
		root: wslAi,
		project: "c-Users-me-wsl-ai",
		sessionId: "wsl-ai-session",
		lines: [sessionMetaLine("wsl-ai-session")],
	});

	setWslHomesForTesting([wslHome]);
	try {
		const info = await workbuddyAdapter.detect();
		assert.ok(info);
		assert.equal(info.name, "workbuddy");
		// One local session plus one session in each build's WSL home.
		assert.equal(info.conversationCount, 3);
		// detect still reports the Windows-local primary root.
		assert.equal(info.dataDir, primary);

		const metas = await workbuddyAdapter.scan();
		assert.equal(metas.length, 3);
		const wslMeta = metas.find((meta) => meta.id === "wsl-session");
		assert.ok(wslMeta);
		assert.equal(wslMeta.rootDir, resolve(wslPrimary));
		assert.equal(wslMeta.filePath, wslMainPath);

		const parsed = await workbuddyAdapter.parse(wslMeta);
		assert.equal(parsed.id, "wsl-session");
		assert.equal(parsed.cwd, "/home/me/wsl-app");
		assert.equal(parsed.projectDir, "/home/me/wsl-app");
		assert.equal(parsed.messages.length, 2);
		assert.equal(parsed.messages[0]?.content, "WSL question");
		assert.equal(parsed.messages[1]?.content, "WSL answer");

		const wslAiMeta = metas.find((meta) => meta.id === "wsl-ai-session");
		assert.ok(wslAiMeta);
		assert.equal(wslAiMeta.rootDir, resolve(wslAi));
		assert.equal(wslAiMeta.filePath, wslAiPath);

		// The watcher targets the Windows-local roots only; WSL is manual-import.
		assert.deepEqual(workbuddyAdapter.watchPaths?.(), [
			resolve(primary, "projects", "**", "*.jsonl"),
			resolve(ai, "projects", "**", "*.jsonl"),
		]);
	} finally {
		setWslHomesForTesting(null);
	}
});
