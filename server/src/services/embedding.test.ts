import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LocalIndex } from 'vectra';
import {
  committedVectraIdsForNote,
  currentVectraIdsCommitted,
  materializeDirectSearchHits,
} from './embedding.js';

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'chatcrystal-embedding-'));
}

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
