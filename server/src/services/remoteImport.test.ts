import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ChatCrystalSource,
  ConversationMeta,
  ParsedConversation,
  RemoteImportItem,
} from '@chatcrystal/shared';
import type { SourceAdapter } from '../parser/adapter.js';
import { appConfig } from '../config.js';
import { registerAdapter } from '../parser/index.js';
import {
  chunkRemoteImportItems,
  collectRemoteImportItems,
  runRemoteImport,
  splitUploadableRemoteImportItems,
  validateRemoteImportSource,
} from './remoteImport.js';

function item(id: string): RemoteImportItem {
  return {
    source: 'codex',
    sourceConversationId: id,
    conversationId: `codex:${id}`,
    contentHash: 'a'.repeat(64),
    parserVersion: 'codex@1',
    meta: {
      id,
      source: 'codex',
      filePath: `C:/fixtures/${id}.jsonl`,
      fileSize: 100,
      fileMtime: '2026-05-20T00:00:00Z',
      projectDir: 'C:/repo',
    },
    parsed: {
      id: `codex:${id}`,
      slug: id,
      source: 'codex',
      projectDir: 'C:/repo',
      projectName: 'repo',
      cwd: 'C:/repo',
      gitBranch: 'main',
      firstMessageAt: '2026-05-20T00:00:00Z',
      lastMessageAt: '2026-05-20T00:01:00Z',
      messages: [],
    },
  };
}

function parsedConversation(source: ChatCrystalSource, id: string): ParsedConversation {
  return {
    id,
    slug: id,
    source,
    projectDir: '',
    projectName: '',
    cwd: null,
    gitBranch: null,
    firstMessageAt: '2026-05-20T00:00:00Z',
    lastMessageAt: '2026-05-20T00:01:00Z',
    messages: [
      {
        id: 'm1',
        parentUuid: null,
        type: 'user',
        role: 'user',
        content: `hello from ${source}`,
        hasToolUse: false,
        hasCode: false,
        thinking: null,
        timestamp: '2026-05-20T00:00:00Z',
      },
      {
        id: 'm2',
        parentUuid: 'm1',
        type: 'assistant',
        role: 'assistant',
        content: `world from ${source}`,
        hasToolUse: false,
        hasCode: false,
        thinking: null,
        timestamp: '2026-05-20T00:01:00Z',
      },
    ],
  };
}

function sourceAdapter(source: ChatCrystalSource): SourceAdapter {
  const meta: ConversationMeta = {
    id: `${source}-session`,
    source,
    filePath: `C:/fixtures/${source}.jsonl`,
    fileSize: 100,
    fileMtime: '2026-05-20T00:00:00Z',
    projectDir: '',
  };

  return {
    name: source,
    displayName: source,
    detect: async () => ({
      name: source,
      displayName: source,
      dataDir: 'C:/fixtures',
      conversationCount: 1,
    }),
    scan: async () => [meta],
    parse: async () => parsedConversation(source, meta.id),
    parserVersion: 'test',
  } as SourceAdapter;
}

test('chunkRemoteImportItems limits batches by item count', () => {
  const chunks = chunkRemoteImportItems(Array.from({ length: 26 }, (_, index) => item(`session-${index}`)));
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 25);
  assert.equal(chunks[1].length, 1);
});

test('chunkRemoteImportItems also limits batches by serialized byte size', () => {
  const chunks = chunkRemoteImportItems([
    item('small-1'),
    item('small-2'),
    item('small-3'),
  ], 25, Buffer.byteLength(JSON.stringify({ version: 1, items: [item('small-1'), item('small-2')] })));

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 2);
  assert.equal(chunks[1].length, 1);
});


test('validateRemoteImportSource rejects unsupported sources', () => {
  for (const source of ['claude-code', 'codex', 'cursor', 'trae', 'copilot']) {
    assert.doesNotThrow(() => validateRemoteImportSource(source));
  }
  assert.throws(
    () => validateRemoteImportSource('unknown-source'),
    /Unsupported source/,
  );
});

test('collectRemoteImportItems covers all five supported source adapters', async () => {
  const sources: ChatCrystalSource[] = ['claude-code', 'codex', 'cursor', 'trae', 'copilot'];
  for (const source of sources) {
    registerAdapter(sourceAdapter(source));
  }
  appConfig.enabledSources = sources;

  const result = await collectRemoteImportItems();

  assert.equal(result.errors, 0);
  assert.deepEqual(
    new Set(result.items.map((entry) => entry.source)),
    new Set(sources),
  );
});

test('splitUploadableRemoteImportItems isolates oversized conversations', () => {
  const small = item('small');
  const large = item('large');
  large.parsed.messages = [
    {
      id: 'large:m1',
      parentUuid: null,
      type: 'user',
      role: 'user',
      content: 'x'.repeat(9 * 1024 * 1024),
      hasToolUse: false,
      hasCode: false,
      thinking: null,
      timestamp: '2026-05-20T00:00:00Z',
    },
    {
      id: 'large:m2',
      parentUuid: 'large:m1',
      type: 'assistant',
      role: 'assistant',
      content: 'ok',
      hasToolUse: false,
      hasCode: false,
      thinking: null,
      timestamp: '2026-05-20T00:01:00Z',
    },
  ];

  const result = splitUploadableRemoteImportItems([small, large]);
  assert.deepEqual(result.uploadableItems.map((entry) => entry.sourceConversationId), ['small']);
  assert.deepEqual(result.oversizedItems.map((entry) => entry.sourceConversationId), ['large']);
});

test('runRemoteImport accumulates structured ids returned by remote ingest', async () => {
  registerAdapter(sourceAdapter('codex'));
  appConfig.enabledSources = ['codex'];

  const result = await runRemoteImport({
    ingestConversations: async (request) => {
      const ids = request.items.map((entry) => entry.conversationId);
      return {
        total: request.items.length,
        imported: ids.length,
        replaced: 0,
        skipped: 0,
        errors: 0,
        importedIds: ids,
        replacedIds: [],
        skippedIds: [],
        errorIds: [],
        summarizationCandidateIds: ids,
        items: request.items.map((entry) => ({
          source: entry.source,
          sourceConversationId: entry.sourceConversationId,
          conversationId: entry.conversationId,
          status: 'imported',
        })),
      };
    },
  });

  assert.deepEqual(result.importedIds, ['codex:codex-session']);
  assert.deepEqual(result.replacedIds, []);
  assert.deepEqual(result.skippedIds, []);
  assert.deepEqual(result.errorIds, []);
  assert.deepEqual(result.summarizationCandidateIds, ['codex:codex-session']);
});
