import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type {
	ConversationMeta,
	ParsedConversation,
	ParsedMessage,
} from '@chatcrystal/shared';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chatcrystal-import-options-test-'));

type Runtime = {
	importAll: (
		options?: unknown,
	) => Promise<{
		phase: string;
		cancelled: boolean;
		total: number;
		current: number;
		imported: number;
		replaced: number;
		skipped: number;
		errors: number;
		sources: Array<{
			source: string;
			displayName: string;
			status: string;
			found: number;
			processed: number;
			imported: number;
			replaced: number;
			skipped: number;
			errors: number;
			error?: string;
		}>;
		errorsDetail: Array<{ source: string; filePath: string; message: string }>;
	}>;
	registerAdapter: (adapter: import('../parser/adapter.js').SourceAdapter) => void;
	appConfig: { enabledSources: string[] };
};

let runtime: Promise<Runtime> | null = null;

async function loadRuntime(): Promise<Runtime> {
	if (!runtime) {
		runtime = Promise.all([
			import('./import.js'),
			import('../db/index.js'),
			import('../parser/index.js'),
			import('../config.js'),
		]).then(async ([importService, dbService, parser, config]) => {
			await dbService.initDatabase();
			return {
				importAll: importService.importAll as Runtime['importAll'],
				registerAdapter: parser.registerAdapter,
				appConfig: config.appConfig,
			};
		});
	}
	return runtime;
}

function meta(
	id: string,
	source: string,
	filePath = `C:/fixtures/${id}.jsonl`,
): ConversationMeta {
	return {
		id,
		source,
		filePath,
		fileSize: 20,
		fileMtime: '2026-04-29T00:00:00Z',
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
	const messages = [
		message(id, 1, 'user'),
		message(id, 2, 'assistant'),
	];
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

function adapterFor(
	name: string,
	metas: ConversationMeta[],
	options?: {
		parse?: (meta: ConversationMeta) => Promise<ParsedConversation>;
	},
): import('../parser/adapter.js').SourceAdapter {
	return {
		name,
		displayName: `Test ${name}`,
		detect: async () => ({
			name,
			displayName: `Test ${name}`,
			dataDir: 'C:/fixtures',
			conversationCount: metas.length,
		}),
		scan: async () => metas,
		parse:
			options?.parse ??
			(async (item) => parsed(item.id, item.source)),
	};
}

test('restricts the import to the requested sources and reports per-source progress', async () => {
	const rt = await loadRuntime();
	const sourceA = 'test-options-a';
	const sourceB = 'test-options-b';
	rt.registerAdapter(
		adapterFor(sourceA, [
			meta(`${sourceA}-1`, sourceA),
			meta(`${sourceA}-2`, sourceA),
		]),
	);
	rt.registerAdapter(adapterFor(sourceB, [meta(`${sourceB}-1`, sourceB)]));
	rt.appConfig.enabledSources = [sourceA, sourceB];

	const phases: string[] = [];
	const result = await rt.importAll({
		sources: [sourceA],
		onProgress: (progress: { phase: string }) => {
			phases.push(progress.phase);
		},
	});

	assert.equal(result.imported, 2);
	assert.equal(result.errors, 0);
	assert.equal(result.phase, 'done');
	assert.equal(result.sources.length, 1);
	const entry = result.sources[0];
	assert.equal(entry.source, sourceA);
	assert.equal(entry.displayName, `Test ${sourceA}`);
	assert.equal(entry.status, 'done');
	assert.equal(entry.found, 2);
	assert.equal(entry.processed, 2);
	assert.equal(entry.imported, 2);
	assert.ok(phases.includes('detecting'));
	assert.ok(phases.includes('importing'));
	assert.equal(phases[phases.length - 1], 'done');
});

test('returns a cancelled result without importing when the signal is already aborted', async () => {
	const rt = await loadRuntime();
	const source = 'test-options-cancelled';
	rt.registerAdapter(adapterFor(source, [meta(`${source}-1`, source)]));
	rt.appConfig.enabledSources = [source];

	const controller = new AbortController();
	controller.abort();
	const result = await rt.importAll({ signal: controller.signal });

	assert.equal(result.phase, 'cancelled');
	assert.equal(result.cancelled, true);
	assert.equal(result.imported, 0);
	assert.equal(result.total, 0);
});

test('collects error details and keeps going after a failed parse', async () => {
	const rt = await loadRuntime();
	const source = 'test-options-errors';
	const failingId = `${source}-bad`;
	rt.registerAdapter(
		adapterFor(
			source,
			[meta(failingId, source), meta(`${source}-good`, source)],
			{
				parse: async (item) => {
					if (item.id === failingId) {
						throw new Error('fixture parse failure');
					}
					return parsed(item.id, item.source);
				},
			},
		),
	);
	rt.appConfig.enabledSources = [source];

	const result = await rt.importAll({ sources: [source] });

	assert.equal(result.errors, 1);
	assert.equal(result.imported, 1);
	assert.equal(result.errorsDetail.length, 1);
	assert.deepEqual(result.errorsDetail[0], {
		source,
		filePath: `C:/fixtures/${failingId}.jsonl`,
		message: 'fixture parse failure',
	});
	const entry = result.sources.find((item) => item.source === source);
	assert.equal(entry?.errors, 1);
	assert.equal(entry?.imported, 1);
});

test('parses through the injected parse pool', async () => {
	const rt = await loadRuntime();
	const source = 'test-options-pool';
	const item = meta(`${source}-1`, source);
	let poolCalls = 0;
	rt.registerAdapter(
		adapterFor(source, [item], {
			parse: async () => {
				throw new Error('inline parse should not be used');
			},
		}),
	);
	rt.appConfig.enabledSources = [source];

	const result = await rt.importAll({
		sources: [source],
		parsePool: {
			parse: async (poolMeta: ConversationMeta) => {
				poolCalls++;
				return parsed(poolMeta.id, poolMeta.source);
			},
			close: async () => {},
		},
	});

	assert.equal(poolCalls, 1);
	assert.equal(result.imported, 1);
	assert.equal(result.errors, 0);
});
