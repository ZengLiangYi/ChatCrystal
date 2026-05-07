import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LocalIndex } from 'vectra';
import {
  buildNoteEmbeddingText,
  committedVectraIdsForNote,
  currentVectraIdsCommitted,
  deleteVectraItemsForNote,
  maybeFinalizeCommittedSyncingNote,
  materializeDirectSearchHits,
  semanticSearch,
} from './embedding.js';

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'chatcrystal-embedding-'));
}

test('buildNoteEmbeddingText includes structured agent writeback memory signals', () => {
  const text = buildNoteEmbeddingText({
    title: 'Server readiness race causes ECONNREFUSED',
    summary: 'Requests must wait for server readiness before client calls.',
    keyConclusionsJson: JSON.stringify([
      'Await readiness before issuing HTTP requests.',
      'Visible key conclusions stay searchable.',
    ]),
    codeSnippetsJson: JSON.stringify([
      { description: 'Readiness helper wraps Fastify startup.' },
      { code: 'console.log("ignored because no description")' },
    ]),
    tagsText: 'readiness testing',
    sourceType: 'agent-writeback',
    rawPayloadJson: JSON.stringify({
      root_cause: 'Client calls raced server startup.',
      resolution: 'Block request setup until server readiness resolves.',
      pitfalls: ['Do not fire API requests before Fastify ready.'],
      reusable_patterns: ['Share a readiness helper across HTTP tests.'],
      decisions: ['Keep readiness helper in test utilities.'],
    }),
    errorSignaturesJson: JSON.stringify(['ECONNREFUSED 127.0.0.1:3721']),
    filesTouchedJson: JSON.stringify(['server/src/test/readiness.ts']),
  });

  assert.match(text, /Server readiness race causes ECONNREFUSED/);
  assert.match(text, /Requests must wait for server readiness/);
  assert.match(text, /Await readiness before issuing HTTP requests/);
  assert.match(text, /Visible key conclusions stay searchable/);
  assert.match(text, /readiness testing/);
  assert.match(text, /Readiness helper wraps Fastify startup/);
  assert.match(text, /Root cause: Client calls raced server startup\./);
  assert.match(text, /Resolution: Block request setup until server readiness resolves\./);
  assert.match(text, /Pitfall: Do not fire API requests before Fastify ready\./);
  assert.match(text, /Pattern: Share a readiness helper across HTTP tests\./);
  assert.match(text, /Decision: Keep readiness helper in test utilities\./);
  assert.match(text, /Error signature: ECONNREFUSED 127\.0\.0\.1:3721/);
  assert.match(text, /File: server\/src\/test\/readiness\.ts/);
});

test('buildNoteEmbeddingText ignores malformed JSON defensively', () => {
  assert.doesNotThrow(() => {
    buildNoteEmbeddingText({
      title: 'Malformed memory payload',
      summary: 'Embedding text still includes stable fields.',
      keyConclusionsJson: '{not-json',
      codeSnippetsJson: 'also-not-json',
      tagsText: null,
      sourceType: 'agent-writeback',
      rawPayloadJson: '{"root_cause"',
      errorSignaturesJson: '[broken',
      filesTouchedJson: '{broken',
    });
  });
});

test('buildNoteEmbeddingText skips raw memory payload details for imported conversations', () => {
  const text = buildNoteEmbeddingText({
    title: 'Imported conversation note',
    summary: 'Imported summaries still embed visible note fields.',
    keyConclusionsJson: JSON.stringify(['Visible imported conclusion.']),
    codeSnippetsJson: '[]',
    tagsText: null,
    sourceType: 'imported-conversation',
    rawPayloadJson: JSON.stringify({
      root_cause: 'SHOULD_NOT_EMBED_ROOT_CAUSE',
      reusable_patterns: ['SHOULD_NOT_EMBED_PATTERN'],
      decisions: ['SHOULD_NOT_EMBED_DECISION'],
    }),
    errorSignaturesJson: JSON.stringify(['SHOULD_NOT_EMBED_SIGNATURE']),
    filesTouchedJson: JSON.stringify(['SHOULD_NOT_EMBED_FILE']),
  });

  assert.match(text, /Imported conversation note/);
  assert.match(text, /Visible imported conclusion/);
  assert.equal(text.includes('SHOULD_NOT_EMBED_ROOT_CAUSE'), false);
  assert.equal(text.includes('SHOULD_NOT_EMBED_PATTERN'), false);
  assert.equal(text.includes('SHOULD_NOT_EMBED_DECISION'), false);
  assert.equal(text.includes('SHOULD_NOT_EMBED_SIGNATURE'), false);
  assert.equal(text.includes('SHOULD_NOT_EMBED_FILE'), false);
});

test('committed vectra ids come from persisted index state, not staged updates', async () => {
  const dir = createTempDir();
  const index = new LocalIndex(join(dir, 'vectra-index'));

  try {
    await index.createIndex();

    const committed = await index.insertItem({
      vector: [1, 0, 0],
      metadata: { noteId: 7, chunkIndex: 0, conversationId: 'conv-a', title: 'A', projectName: 'P' },
    });

    await index.beginUpdate();
    const staged = await index.insertItem({
      vector: [0, 1, 0],
      metadata: { noteId: 7, chunkIndex: 1, conversationId: 'conv-a', title: 'A', projectName: 'P' },
    });
    await index.cancelUpdate();

    const committedIds = await committedVectraIdsForNote(index, 7);

    assert.deepEqual(committedIds, [committed.id]);
    assert.equal(committedIds.includes(staged.id), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('currentVectraIdsCommitted distinguishes staged-only ids from committed ids', async () => {
  const dir = createTempDir();
  const index = new LocalIndex(join(dir, 'vectra-index'));

  try {
    await index.createIndex();

    const committed = await index.insertItem({
      vector: [1, 0, 0],
      metadata: { noteId: 9, chunkIndex: 0, conversationId: 'conv-b', title: 'B', projectName: 'P' },
    });

    await index.beginUpdate();
    const staged = await index.insertItem({
      vector: [0, 1, 0],
      metadata: { noteId: 9, chunkIndex: 1, conversationId: 'conv-b', title: 'B', projectName: 'P' },
    });

    assert.equal(await currentVectraIdsCommitted(index, [committed.id]), true);
    assert.equal(await currentVectraIdsCommitted(index, [staged.id]), false);

    await index.cancelUpdate();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('currentVectraIdsCommitted returns true only when every id is committed', async () => {
  const dir = createTempDir();
  const index = new LocalIndex(join(dir, 'vectra-index'));

  try {
    await index.createIndex();

    const first = await index.insertItem({
      vector: [1, 0, 0],
      metadata: { noteId: 11, chunkIndex: 0, conversationId: 'conv-d', title: 'D', projectName: 'P' },
    });
    const second = await index.insertItem({
      vector: [0, 1, 0],
      metadata: { noteId: 11, chunkIndex: 1, conversationId: 'conv-d', title: 'D', projectName: 'P' },
    });

    assert.equal(await currentVectraIdsCommitted(index, [first.id, second.id]), true);
    assert.equal(await currentVectraIdsCommitted(index, [first.id, 'missing-id']), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleteVectraItemsForNote removes only items for the requested note id', async () => {
  const dir = createTempDir();
  const index = new LocalIndex(join(dir, 'vectra-index'));

  try {
    await index.createIndex();

    await index.insertItem({
      vector: [1, 0, 0],
      metadata: { noteId: 13, chunkIndex: 0, conversationId: 'conv-c', title: 'C', projectName: 'P' },
    });
    await index.insertItem({
      vector: [0.9, 0.1, 0],
      metadata: { noteId: 13, chunkIndex: 1, conversationId: 'conv-c', title: 'C', projectName: 'P' },
    });
    const otherNote = await index.insertItem({
      vector: [0, 1, 0],
      metadata: { noteId: 14, chunkIndex: 0, conversationId: 'conv-d', title: 'D', projectName: 'P' },
    });

    const deleted = await deleteVectraItemsForNote(index, 13);

    assert.equal(deleted, 2);
    assert.deepEqual(await committedVectraIdsForNote(index, 13), []);
    assert.deepEqual(await committedVectraIdsForNote(index, 14), [otherNote.id]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('syncing note with committed ids can finalize without re-embedding', async () => {
  const dir = createTempDir();
  const index = new LocalIndex(join(dir, 'vectra-index'));
  let updatedNoteId: number | null = null;
  let saveCount = 0;

  try {
    await index.createIndex();

    const first = await index.insertItem({
      vector: [1, 0, 0],
      metadata: { noteId: 15, chunkIndex: 0, conversationId: 'conv-e', title: 'E', projectName: 'P' },
    });
    const second = await index.insertItem({
      vector: [0, 1, 0],
      metadata: { noteId: 15, chunkIndex: 1, conversationId: 'conv-e', title: 'E', projectName: 'P' },
    });

    const finalized = await maybeFinalizeCommittedSyncingNote(
      {
        run(sql: string, params?: unknown[]) {
          if (sql === "UPDATE notes SET embedding_status = 'done' WHERE id = ?") {
            updatedNoteId = Number(params?.[0]);
            return;
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      } as never,
      index,
      15,
      'syncing',
      [first.id, second.id],
      () => {
        saveCount += 1;
      },
    );

    assert.equal(finalized, true);
    assert.equal(updatedNoteId, 15);
    assert.equal(saveCount, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('semantic-search direct-hit materialization validates SQLite-backed chunks before deduping', async () => {
  const db = {
    exec(sql: string, params: unknown[]) {
      if (sql.includes('FROM embeddings e')) {
        if (params[1] === 0) {
          return [{ values: [] }];
        }
        return [{ values: [['valid chunk text']] }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const results = [
    {
      item: {
        metadata: {
          noteId: 21,
          chunkIndex: 0,
          conversationId: 'conv-c',
          title: 'Title',
          projectName: 'Project',
        },
      },
      score: 0.99,
    },
    {
      item: {
        metadata: {
          noteId: 21,
          chunkIndex: 1,
          conversationId: 'conv-c',
          title: 'Title',
          projectName: 'Project',
        },
      },
      score: 0.75,
    },
  ];

  const directResults = await materializeDirectSearchHits(db as never, results as never);

  assert.deepEqual(directResults, [
    {
      noteId: 21,
      conversationId: 'conv-c',
      title: 'Title',
      projectName: 'Project',
      score: 0.75,
      chunkText: 'valid chunk text',
      viaRelation: undefined,
    },
  ]);
});

test('semanticSearch overfetches when stale vectra hits fill the requested topK', async () => {
  const queryTopKs: number[] = [];
  const staleHit = {
    item: {
      metadata: {
        noteId: 41,
        chunkIndex: 0,
        conversationId: 'conv-stale',
        title: 'Stale',
        projectName: 'Project',
      },
    },
    score: 0.99,
  };
  const validHit = {
    item: {
      metadata: {
        noteId: 42,
        chunkIndex: 0,
        conversationId: 'conv-valid',
        title: 'Valid',
        projectName: 'Project',
      },
    },
    score: 0.88,
  };
  const index = {
    async isIndexCreated() {
      return true;
    },
    async getIndexStats() {
      return { version: 1, metadata_config: {}, items: 2 };
    },
    async queryItems(_embedding: number[], _query: string, topK: number) {
      queryTopKs.push(topK);
      return topK === 1 ? [staleHit] : [staleHit, validHit];
    },
  };
  const db = {
    exec(sql: string, params: unknown[]) {
      if (sql.includes('FROM embeddings e')) {
        if (params[0] === 41) {
          return [{ values: [] }];
        }
        assert.deepEqual(params, [42, 0]);
        return [{ values: [['valid chunk text']] }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const results = await semanticSearch('q', 1, false, {
    getIndex: async () => index as never,
    embedQuery: async () => [1, 0, 0],
    cleanupPreflight: async () => {},
    getDb: () => db as never,
  });

  assert.deepEqual(results, [
    {
      noteId: 42,
      conversationId: 'conv-valid',
      title: 'Valid',
      projectName: 'Project',
      score: 0.88,
      chunkText: 'valid chunk text',
      viaRelation: undefined,
    },
  ]);
  assert.deepEqual(queryTopKs, [1, 2]);
});

test('semanticSearch returns early for non-positive topK without cleanup or embedding', async () => {
  const calls: string[] = [];

  const results = await semanticSearch('q', 0, false, {
    getIndex: async () => {
      calls.push('getIndex');
      throw new Error('getIndex should not run');
    },
    embedQuery: async () => {
      calls.push('embed');
      throw new Error('embed should not run');
    },
    cleanupPreflight: async () => {
      calls.push('cleanup');
      throw new Error('cleanup should not run');
    },
    getDb: () => {
      calls.push('getDb');
      throw new Error('getDb should not run');
    },
  });

  assert.deepEqual(results, []);
  assert.deepEqual(calls, []);
});

test('semanticSearch runs vector cleanup preflight before querying vectra', async () => {
  const calls: string[] = [];
  const index = {
    async isIndexCreated() {
      calls.push('isIndexCreated');
      return true;
    },
    async queryItems(_embedding: number[], _query: string, topK: number) {
      calls.push(`queryItems:${topK}`);
      return [
        {
          item: {
            metadata: {
              noteId: 31,
              chunkIndex: 0,
              conversationId: 'conv-preflight',
              title: 'Preflight',
              projectName: 'Project',
            },
          },
          score: 0.9,
        },
      ];
    },
  };
  const db = {
    exec(sql: string, params: unknown[]) {
      if (sql.includes('FROM embeddings e')) {
        assert.deepEqual(params, [31, 0]);
        return [{ values: [['kept chunk']] }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const results = await semanticSearch('query', 7, false, {
    getIndex: async () => index as never,
    embedQuery: async () => {
      calls.push('embed');
      return [1, 0, 0];
    },
    cleanupPreflight: async () => {
      calls.push('cleanup');
    },
    getDb: () => db as never,
  });

  assert.deepEqual(results, [
    {
      noteId: 31,
      conversationId: 'conv-preflight',
      title: 'Preflight',
      projectName: 'Project',
      score: 0.9,
      chunkText: 'kept chunk',
      viaRelation: undefined,
    },
  ]);
  assert.ok(calls.indexOf('cleanup') > -1);
  assert.ok(calls.indexOf('cleanup') < calls.indexOf('queryItems:7'));
});

test('semanticSearch keeps searching when vector cleanup preflight fails', async () => {
  const calls: string[] = [];
  const index = {
    async isIndexCreated() {
      return true;
    },
    async queryItems(_embedding: number[], _query: string, topK: number) {
      calls.push(`queryItems:${topK}`);
      return [];
    },
  };

  const results = await semanticSearch('query', 3, false, {
    getIndex: async () => index as never,
    embedQuery: async () => [1, 0, 0],
    cleanupPreflight: async () => {
      calls.push('cleanup');
      throw new Error('cleanup failed');
    },
    getDb: () => ({ exec: () => [] }) as never,
  });

  assert.deepEqual(results, []);
  assert.deepEqual(calls, ['cleanup', 'queryItems:3']);
});
