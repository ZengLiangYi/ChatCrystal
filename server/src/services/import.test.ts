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
import type { Database } from 'sql.js';
import type { SourceAdapter } from '../parser/adapter.js';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chatcrystal-import-test-'));

type ImportRuntime = {
	db: Database;
	importAll: () => Promise<{ imported: number; skipped: number; errors: number }>;
	registerAdapter: (adapter: SourceAdapter) => void;
	appConfig: { enabledSources: string[] };
	getUnsummarizedIds: () => string[];
};

let runtime: Promise<ImportRuntime> | null = null;

async function loadRuntime(): Promise<ImportRuntime> {
	if (!runtime) {
		runtime = Promise.all([
			import('./import.js'),
			import('../db/index.js'),
			import('../parser/index.js'),
			import('../config.js'),
			import('./summarize.js'),
		]).then(async ([importService, dbService, parser, config, summarize]) => ({
			db: await dbService.initDatabase(),
			importAll: importService.importAll,
			registerAdapter: parser.registerAdapter,
			appConfig: config.appConfig,
			getUnsummarizedIds: summarize.getUnsummarizedIds,
		}));
	}
	return runtime;
}

function resetDatabase(db: Database) {
	db.exec(`
		PRAGMA foreign_keys = ON;
		DELETE FROM experience_reviews;
		DELETE FROM note_tags;
		DELETE FROM embeddings;
		DELETE FROM note_relations;
		DELETE FROM notes;
		DELETE FROM messages;
		DELETE FROM conversations;
		DELETE FROM import_log;
		DELETE FROM vector_cleanup_tasks;
	`);
}

function conversationMeta(
	id: string,
	source: string,
	fileSize: number,
	fileMtime: string,
): ConversationMeta {
	return {
		id,
		source,
		filePath: `C:/fixtures/${id}.jsonl`,
		fileSize,
		fileMtime,
		projectDir: 'C:/repo',
	};
}

function parsedMessage(
	conversationId: string,
	index: number,
	type: ParsedMessage['type'],
	content: string,
): ParsedMessage {
	return {
		id: `${conversationId}-message-${index}`,
		parentUuid: null,
		type,
		role: type,
		content,
		hasToolUse: false,
		hasCode: content.includes('server/src'),
		thinking: null,
		timestamp: `2026-04-29T00:0${index}:00Z`,
	};
}

function parsedConversation(
	id: string,
	source: string,
	messages: string[],
): ParsedConversation {
	const parsedMessages = messages.map((content, index) =>
		parsedMessage(
			id,
			index + 1,
			index % 2 === 0 ? 'user' : 'assistant',
			content,
		),
	);

	return {
		id,
		slug: `${id}-slug`,
		source,
		projectDir: 'C:/repo',
		projectName: 'repo',
		cwd: 'C:/repo',
		gitBranch: 'main',
		messages: parsedMessages,
		firstMessageAt: parsedMessages[0].timestamp,
		lastMessageAt: parsedMessages[parsedMessages.length - 1].timestamp,
	};
}

function testAdapter(
	name: string,
	metas: ConversationMeta[],
	parsedById: Map<string, ParsedConversation>,
): SourceAdapter {
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
		parse: async (meta) => {
			const parsed = parsedById.get(meta.id);
			if (!parsed) throw new Error(`Missing parsed fixture for ${meta.id}`);
			return parsed;
		},
	};
}

function insertExistingConversation(
	db: Database,
	options: {
		id: string;
		source: string;
		status: string;
		fileSize?: number;
		fileMtime?: string;
		experienceScore?: number | null;
		experienceGateReason?: string | null;
		experienceGateDetails?: string | null;
	},
) {
	db.run(
		`INSERT INTO conversations (
			id, slug, source, project_dir, project_name, cwd, git_branch,
			message_count, first_message_at, last_message_at,
			file_path, file_size, file_mtime, status,
			experience_score, experience_gate_reason, experience_gate_details
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			options.id,
			`${options.id}-old-slug`,
			options.source,
			'C:/repo',
			'repo',
			'C:/repo',
			'main',
			2,
			'2026-04-29T00:00:00Z',
			'2026-04-29T00:01:00Z',
			`C:/fixtures/${options.id}.jsonl`,
			options.fileSize ?? 10,
			options.fileMtime ?? '2026-04-29T00:00:00Z',
			options.status,
			options.experienceScore ?? null,
			options.experienceGateReason ?? null,
			options.experienceGateDetails ?? null,
		],
	);
}

function insertExistingMessage(db: Database, conversationId: string, content: string) {
	db.run(
		`INSERT INTO messages (
			id, conversation_id, type, role, content, has_tool_use, has_code,
			timestamp, sort_order
		) VALUES (?, ?, 'user', 'user', ?, 0, 0, ?, 1)`,
		[
			`${conversationId}-old-message`,
			conversationId,
			content,
			'2026-04-29T00:00:00Z',
		],
	);
}

function insertExistingNote(db: Database, noteId: number, conversationId: string) {
	db.run(
		`INSERT INTO notes (
			id, conversation_id, title, summary, key_conclusions, code_snippets
		) VALUES (?, ?, ?, ?, ?, ?)`,
		[
			noteId,
			conversationId,
			'Stale note',
			'This note describes the old conversation content.',
			'[]',
			'[]',
		],
	);
}

test('importAll preserves user-rejected review links and gate state when reimporting changed conversations', async () => {
	const { db, importAll, registerAdapter, appConfig, getUnsummarizedIds } =
		await loadRuntime();
	resetDatabase(db);

	const source = 'test-rejected-reimport';
	const conversationId = 'conv-rejected-reimport';
	const gateDetails = JSON.stringify({
		feedback: {
			verdict: 'false_accept',
			reason: 'low-value',
			source: 'web',
		},
	});

	insertExistingConversation(db, {
		id: conversationId,
		source,
		status: 'filtered',
		experienceScore: 86,
		experienceGateReason: 'user-rejected-note',
		experienceGateDetails: gateDetails,
	});
	insertExistingMessage(db, conversationId, 'old rejected message');
	insertExistingNote(db, 1, conversationId);
	db.run(
		`INSERT INTO experience_reviews (
			target_type, target_id, conversation_id, note_id, verdict, reason, source
		) VALUES ('note', '1', ?, 1, 'false_accept', 'low-value', 'web')`,
		[conversationId],
	);

	registerAdapter(
		testAdapter(
			source,
			[conversationMeta(conversationId, source, 20, '2026-04-29T00:02:00Z')],
			new Map([
				[
					conversationId,
					parsedConversation(conversationId, source, [
						'new rejected user message',
						'new rejected assistant message',
					]),
				],
			]),
		),
	);
	appConfig.enabledSources = [source];

	const progress = await importAll();

	const conversation = db.exec(
		`SELECT status, experience_score, experience_gate_reason, experience_gate_details
		   FROM conversations WHERE id = ?`,
		[conversationId],
	)[0].values[0];
	const messages = db.exec(
		`SELECT content FROM messages WHERE conversation_id = ? ORDER BY sort_order`,
		[conversationId],
	)[0].values.map((row) => String(row[0]));
	const reviews = db.exec(
		`SELECT conversation_id, note_id FROM experience_reviews WHERE target_id = '1'`,
	)[0].values;
	const notes = db.exec(
		'SELECT COUNT(*) FROM notes WHERE conversation_id = ?',
		[conversationId],
	);

	assert.equal(progress.imported, 1);
	assert.deepEqual(conversation, [
		'filtered',
		86,
		'user-rejected-note',
		gateDetails,
	]);
	assert.deepEqual(messages, [
		'new rejected user message',
		'new rejected assistant message',
	]);
	assert.deepEqual(reviews, [[conversationId, null]]);
	assert.equal(Number(notes[0].values[0][0]), 0);
	assert.equal(getUnsummarizedIds().includes(conversationId), false);
});

test('importAll resets ordinary changed conversations to imported and clears stale notes and messages', async () => {
	const { db, importAll, registerAdapter, appConfig } = await loadRuntime();
	resetDatabase(db);

	const source = 'test-ordinary-reimport';
	const conversationId = 'conv-ordinary-reimport';

	insertExistingConversation(db, {
		id: conversationId,
		source,
		status: 'summarized',
		experienceScore: 78,
		experienceGateReason: 'experience-threshold-met',
		experienceGateDetails: '{"decision":"accept"}',
	});
	insertExistingMessage(db, conversationId, 'old ordinary message');
	insertExistingNote(db, 2, conversationId);

	registerAdapter(
		testAdapter(
			source,
			[conversationMeta(conversationId, source, 30, '2026-04-29T00:03:00Z')],
			new Map([
				[
					conversationId,
					parsedConversation(conversationId, source, [
						'new ordinary user message',
						'new ordinary assistant message',
					]),
				],
			]),
		),
	);
	appConfig.enabledSources = [source];

	const progress = await importAll();

	const conversation = db.exec(
		`SELECT status, experience_score, experience_gate_reason, experience_gate_details
		   FROM conversations WHERE id = ?`,
		[conversationId],
	)[0].values[0];
	const messages = db.exec(
		`SELECT content FROM messages WHERE conversation_id = ? ORDER BY sort_order`,
		[conversationId],
	)[0].values.map((row) => String(row[0]));
	const notes = db.exec(
		'SELECT COUNT(*) FROM notes WHERE conversation_id = ?',
		[conversationId],
	);

	assert.equal(progress.imported, 1);
	assert.deepEqual(conversation, ['imported', null, null, null]);
	assert.deepEqual(messages, [
		'new ordinary user message',
		'new ordinary assistant message',
	]);
	assert.equal(Number(notes[0].values[0][0]), 0);
});
