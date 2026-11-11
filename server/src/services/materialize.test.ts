import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import type {
	ConversationMeta,
	ParsedConversation,
	ParsedMessage,
} from '@chatcrystal/shared';

process.env.DATA_DIR = mkdtempSync(
	join(tmpdir(), 'chatcrystal-materialize-test-'),
);
// Transcript cache stays enabled (the default): the materialize tests prove the
// cache path can serve a pending conversation without invoking the adapter.

type Runtime = {
	importAll: typeof import('./import.js').importAll;
	materializeConversationById: typeof import('./import.js').materializeConversationById;
	registerAdapter: typeof import('../parser/index.js').registerAdapter;
	appConfig: { enabledSources: string[] };
	db: Awaited<ReturnType<typeof import('../db/index.js').initDatabase>>;
};

let runtime: Promise<Runtime> | null = null;

async function loadRuntime(): Promise<Runtime> {
	if (!runtime) {
		runtime = Promise.all([
			import('./import.js'),
			import('../db/index.js'),
			import('../parser/index.js'),
			import('../config.js'),
		]).then(async ([importService, dbService, parser, config]) => ({
			importAll: importService.importAll,
			materializeConversationById: importService.materializeConversationById,
			registerAdapter: parser.registerAdapter,
			appConfig: config.appConfig as Runtime['appConfig'],
			db: await dbService.initDatabase(),
		}));
	}
	return runtime;
}

function meta(
	id: string,
	source: string,
	fileMtime = '2026-04-29T00:00:00Z',
): ConversationMeta {
	return {
		id,
		source,
		filePath: `C:/fixtures/${id}.jsonl`,
		fileSize: 20,
		fileMtime,
		projectDir: 'C:/repo',
	};
}

function message(
	conversationId: string,
	index: number,
	role: 'user' | 'assistant',
): ParsedMessage {
	return {
		id: `${conversationId}-message-${index}`,
		parentUuid: null,
		type: role,
		role,
		content: `message ${index}`,
		hasToolUse: false,
		hasCode: false,
		thinking: null,
		timestamp: `2026-04-29T00:0${index}:00Z`,
	};
}

function parsed(id: string, source: string): ParsedConversation {
	const messages = [message(id, 1, 'user'), message(id, 2, 'assistant')];
	return {
		id,
		slug: `${id}-slug`,
		source,
		projectDir: 'C:/repo',
		projectName: 'repo',
		cwd: 'C:/repo',
		gitBranch: 'main',
		messages,
		firstMessageAt: messages[0].timestamp,
		lastMessageAt: messages[1].timestamp,
	};
}

function testAdapter(
	name: string,
	metas: ConversationMeta[],
	parseImpl?: (item: ConversationMeta) => Promise<ParsedConversation>,
) {
	return {
		name,
		displayName: `Test ${name}`,
		parserVersion: `${name}@9`,
		detect: async () => ({
			name,
			displayName: `Test ${name}`,
			dataDir: 'C:/fixtures',
			conversationCount: metas.length,
		}),
		scan: async () => metas,
		parse: parseImpl ?? (async (item: ConversationMeta) => parsed(item.id, item.source)),
	};
}

function rowStatus(
	db: Runtime['db'],
	id: string,
): { status: string; messages: number } | null {
	const result = db.exec(
		'SELECT transcript_status, (SELECT COUNT(*) FROM messages WHERE conversation_id = conversations.id) FROM conversations WHERE id = ?',
		[id],
	)[0]?.values[0];
	if (!result) return null;
	return { status: String(result[0]), messages: Number(result[1]) };
}

test('index-first creates pending rows before parsing and materializes them', async () => {
	const rt = await loadRuntime();
	const source = 'materialize-index';
	const metas = [meta(`${source}-a`, source), meta(`${source}-b`, source)];
	const adapter = testAdapter(source, metas);
	rt.registerAdapter(adapter);
	rt.appConfig.enabledSources = [source];

	let pendingSnapshot: { rows: number; pending: number; messages: number } | null =
		null;
	const result = await rt.importAll({
		sources: [source],
		onProgress: (progress) => {
			if (progress.phase !== 'importing' || pendingSnapshot) return;
			const rows = rt.db.exec(
				"SELECT transcript_status, (SELECT COUNT(*) FROM messages WHERE conversation_id = conversations.id) FROM conversations WHERE source = ?",
				[source],
			)[0]?.values ?? [];
			pendingSnapshot = {
				rows: rows.length,
				pending: rows.filter((row) => String(row[0]) === 'pending').length,
				messages: rows.reduce((sum, row) => sum + Number(row[1] ?? 0), 0),
			};
		},
	});

	assert.deepEqual(pendingSnapshot, { rows: 2, pending: 2, messages: 0 });
	assert.equal(result.imported, 2);
	for (const item of metas) {
		assert.deepEqual(rowStatus(rt.db, item.id), { status: 'materialized', messages: 2 });
	}
});

test('a cancelled import keeps pending rows and materializes on demand', async () => {
	const rt = await loadRuntime();
	const source = 'materialize-cancel';
	const item = meta(`${source}-1`, source);
	const adapter = testAdapter(source, [item]);
	rt.registerAdapter(adapter);
	rt.appConfig.enabledSources = [source];

	const controller = new AbortController();
	await rt.importAll({
		sources: [source],
		signal: controller.signal,
		onProgress: (progress) => {
			if (progress.phase === 'importing' && progress.current === 0) {
				controller.abort();
			}
		},
	});

	assert.deepEqual(rowStatus(rt.db, item.id), { status: 'pending', messages: 0 });

	const materialized = await rt.materializeConversationById(item.id);
	assert.equal(materialized, 'materialized');
	assert.deepEqual(rowStatus(rt.db, item.id), { status: 'materialized', messages: 2 });
});

test('pending transcripts are materialized from the transcript cache without parsing', async () => {
	const rt = await loadRuntime();
	const source = 'materialize-cache';
	const item = meta(`${source}-1`, source);
	const adapter = testAdapter(source, [item]);
	rt.registerAdapter(adapter);
	rt.appConfig.enabledSources = [source];

	// A full import writes the parsed transcript into the on-disk cache.
	await rt.importAll({ sources: [source] });
	assert.deepEqual(rowStatus(rt.db, item.id), {
		status: 'materialized',
		messages: 2,
	});

	// Simulate the index pass after an interrupted sync: the row is pending and
	// the adapter is now unable to parse. The cache must serve the transcript.
	rt.db.run('DELETE FROM messages WHERE conversation_id = ?', [item.id]);
	rt.db.run(
		"UPDATE conversations SET transcript_status = 'pending' WHERE id = ?",
		[item.id],
	);
	const originalParse = adapter.parse;
	adapter.parse = async () => {
		throw new Error('adapter.parse must not run when the cache has the transcript');
	};
	try {
		const materialized = await rt.materializeConversationById(item.id);
		assert.equal(materialized, 'materialized');
	} finally {
		adapter.parse = originalParse;
	}
	assert.deepEqual(rowStatus(rt.db, item.id), {
		status: 'materialized',
		messages: 2,
	});
});

test('the detail route materializes an index-only conversation on read', async () => {
	const rt = await loadRuntime();
	const source = 'materialize-route';
	const item = meta(`${source}-1`, source);
	rt.registerAdapter(testAdapter(source, [item]));
	rt.appConfig.enabledSources = [source];

	const controller = new AbortController();
	await rt.importAll({
		sources: [source],
		signal: controller.signal,
		onProgress: (progress) => {
			if (progress.phase === 'importing' && progress.current === 0) {
				controller.abort();
			}
		},
	});
	assert.equal(rowStatus(rt.db, item.id)?.status, 'pending');

	const { conversationRoutes } = await import('../routes/conversations.js');
	const app = Fastify();
	await app.register(conversationRoutes);
	const response = await app.inject({
		method: 'GET',
		url: `/api/conversations/${item.id}`,
	});
	await app.close();

	assert.equal(response.statusCode, 200);
	const body = response.json() as {
		success: boolean;
		data: { id: string; messages: ParsedMessage[]; transcript_status: string };
	};
	assert.equal(body.success, true);
	assert.equal(body.data.id, item.id);
	assert.equal(body.data.messages.length, 2);
	assert.equal(body.data.transcript_status, 'materialized');
});
