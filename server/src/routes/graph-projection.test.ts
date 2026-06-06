import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, afterEach } from 'node:test';
import Fastify from 'fastify';

const dataDir = mkdtempSync(join(tmpdir(), 'chatcrystal-graph-projection-route-test-'));
process.env.DATA_DIR = dataDir;

const dbService = await import('../db/index.js');
const { relationRoutes } = await import('./relations.js');

type TestDatabase = Awaited<ReturnType<typeof dbService.initDatabase>>;

function resetDatabase(db: TestDatabase) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    DELETE FROM experience_reviews;
    DELETE FROM note_tags;
    DELETE FROM embeddings;
    DELETE FROM note_relations;
    DELETE FROM notes;
    DELETE FROM messages;
    DELETE FROM conversations;
    DELETE FROM tags;
    DELETE FROM import_log;
    DELETE FROM vector_cleanup_tasks;
  `);
}

function insertConversation(
  db: TestDatabase,
  input: { id: string; projectName: string; projectDir?: string },
) {
  db.run(
    `INSERT INTO conversations (
      id, source, project_dir, project_name, first_message_at, last_message_at,
      file_path, status
    ) VALUES (?, 'codex', ?, ?, '2026-05-01', '2026-05-01', ?, 'summarized')`,
    [
      input.id,
      input.projectDir ?? `C:/${input.projectName}`,
      input.projectName,
      `C:/${input.projectName}/${input.id}.jsonl`,
    ],
  );
}

function insertNote(
  db: TestDatabase,
  input: {
    id: number;
    conversationId: string;
    title: string;
    createdAt: string;
    sourceType?: string;
    outcomeType?: string;
    taskKind?: string;
    tags?: string[];
  },
) {
  db.run(
    `INSERT INTO notes (
      id, conversation_id, title, summary, source_type, source_agent,
      task_kind, outcome_type, created_at
    ) VALUES (?, ?, ?, ?, ?, 'codex', ?, ?, ?)`,
    [
      input.id,
      input.conversationId,
      input.title,
      `${input.title} summary`,
      input.sourceType ?? 'imported-conversation',
      input.taskKind ?? null,
      input.outcomeType ?? null,
      input.createdAt,
    ],
  );

  for (const tag of input.tags ?? []) {
    db.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', [tag]);
    const tagId = Number(db.exec('SELECT id FROM tags WHERE name = ?', [tag])[0].values[0][0]);
    db.run('INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)', [input.id, tagId]);
  }
}

function insertRelation(
  db: TestDatabase,
  input: {
    source: number;
    target: number;
    type: string;
    confidence: number;
    description?: string;
    createdBy?: string;
  },
) {
  db.run(
    `INSERT INTO note_relations (
      source_note_id, target_note_id, relation_type, confidence, description, created_by
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.source,
      input.target,
      input.type,
      input.confidence,
      input.description ?? null,
      input.createdBy ?? 'llm',
    ],
  );
}

async function createSeededApp() {
  const db = await dbService.initDatabase();
  resetDatabase(db);

  insertConversation(db, { id: 'a1', projectName: 'alpha' });
  insertConversation(db, { id: 'a2', projectName: 'alpha' });
  insertConversation(db, { id: 'a3', projectName: 'alpha' });
  insertConversation(db, { id: 'b1', projectName: 'beta' });

  insertNote(db, {
    id: 1,
    conversationId: 'a1',
    title: 'Central alpha fix',
    createdAt: '2026-05-01 00:00:00',
    sourceType: 'agent-writeback',
    outcomeType: 'fix',
    taskKind: 'debug',
    tags: ['alpha', 'fix'],
  });
  insertNote(db, {
    id: 2,
    conversationId: 'a2',
    title: 'Alpha dependency decision',
    createdAt: '2026-05-02 00:00:00',
    outcomeType: 'decision',
    taskKind: 'implement',
    tags: ['alpha'],
  });
  insertNote(db, {
    id: 3,
    conversationId: 'a3',
    title: 'Alpha related pattern',
    createdAt: '2026-05-03 00:00:00',
    outcomeType: 'pattern',
    taskKind: 'refactor',
  });
  insertNote(db, {
    id: 4,
    conversationId: 'b1',
    title: 'Beta isolated bridge',
    createdAt: '2026-05-04 00:00:00',
    outcomeType: 'pitfall',
    taskKind: 'config',
  });

  insertRelation(db, {
    source: 1,
    target: 2,
    type: 'SIMILAR_TO',
    confidence: 0.9,
    description: '同类修复',
  });
  insertRelation(db, {
    source: 1,
    target: 3,
    type: 'DEPENDS_ON',
    confidence: 0.7,
    description: '依赖模式',
  });
  insertRelation(db, {
    source: 1,
    target: 4,
    type: 'REFERENCES',
    confidence: 0.6,
    description: '跨项目引用',
  });
  insertRelation(db, {
    source: 2,
    target: 3,
    type: 'SIMILAR_TO',
    confidence: 0.4,
    description: '低置信相似',
  });

  const app = Fastify();
  await app.register(relationRoutes);
  return app;
}

async function createTagSeededApp() {
  const db = await dbService.initDatabase();
  resetDatabase(db);

  insertConversation(db, { id: 'a1', projectName: 'alpha' });
  insertConversation(db, { id: 'a2', projectName: 'alpha' });
  insertConversation(db, { id: 'a3', projectName: 'alpha' });
  insertConversation(db, { id: 'b1', projectName: 'beta' });
  insertConversation(db, { id: 'b2', projectName: 'beta' });

  insertNote(db, {
    id: 1,
    conversationId: 'a1',
    title: 'Alpha Windows CI',
    createdAt: '2026-05-01 00:00:00',
    tags: ['github-actions', 'ci-cd', 'windows'],
  });
  insertNote(db, {
    id: 2,
    conversationId: 'a2',
    title: 'Alpha Node CI',
    createdAt: '2026-05-02 00:00:00',
    tags: ['github-actions', 'ci-cd', 'nodejs'],
  });
  insertNote(db, {
    id: 3,
    conversationId: 'a3',
    title: 'Alpha Node workflow',
    createdAt: '2026-05-03 00:00:00',
    tags: ['github-actions', 'nodejs'],
  });
  insertNote(db, {
    id: 4,
    conversationId: 'b1',
    title: 'Beta deploy workflow',
    createdAt: '2026-05-04 00:00:00',
    tags: ['github-actions', 'deploy'],
  });
  insertNote(db, {
    id: 5,
    conversationId: 'b2',
    title: 'Beta Windows deploy',
    createdAt: '2026-05-05 00:00:00',
    tags: ['deploy', 'windows'],
  });

  const app = Fastify();
  await app.register(relationRoutes);
  return app;
}

afterEach(() => {
  dbService.closeDatabase();
});

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

test('GET /api/graph/projection returns a bounded note graph with complete edge endpoints', async () => {
  const app = await createSeededApp();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/graph/projection?level=note&limit=2',
    });

    assert.equal(response.statusCode, 200);
    const data = response.json().data;
    assert.equal(data.nodes.length, 2);
    assert.equal(data.stats.totalNodes, 4);
    assert.equal(data.truncated, true);
    assert.deepEqual(
      data.nodes.map((node: Record<string, unknown>) => node.id),
      [1, 4],
    );
    assert.deepEqual(
      data.edges.map((edge: Record<string, unknown>) => [edge.source, edge.target, edge.type]),
      [[1, 4, 'REFERENCES']],
    );
    assert.deepEqual(data.nodes[0], {
      id: 1,
      kind: 'note',
      title: 'Central alpha fix',
      project_name: 'alpha',
      tags: ['alpha', 'fix'],
      degree: 3,
      source_type: 'agent-writeback',
      outcome_type: 'fix',
      task_kind: 'debug',
    });
  } finally {
    await app.close();
  }
});

test('GET /api/graph/projection filters by project, relation type, and minimum confidence', async () => {
  const app = await createSeededApp();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/graph/projection?project=alpha&relationType=SIMILAR_TO&minConfidence=0.8&limit=10',
    });

    assert.equal(response.statusCode, 200);
    const data = response.json().data;
    assert.equal(data.truncated, false);
    assert.equal(data.stats.totalNodes, 3);
    assert.deepEqual(
      data.nodes.map((node: Record<string, unknown>) => node.project_name),
      ['alpha', 'alpha', 'alpha'],
    );
    assert.deepEqual(
      data.edges.map((edge: Record<string, unknown>) => ({
        source: edge.source,
        target: edge.target,
        type: edge.type,
        confidence: edge.confidence,
        description: edge.description,
        created_by: edge.created_by,
      })),
      [
        {
          source: 1,
          target: 2,
          type: 'SIMILAR_TO',
          confidence: 0.9,
          description: '同类修复',
          created_by: 'llm',
        },
      ],
    );
  } finally {
    await app.close();
  }
});

test('GET /api/graph/projection level=tag returns bounded normalized co-occurrence edges', async () => {
  const app = await createTagSeededApp();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/graph/projection?level=tag&limit=4&minScore=0.5',
    });

    assert.equal(response.statusCode, 200);
    const data = response.json().data;
    assert.equal(data.stats.totalNodes, 5);
    assert.equal(data.stats.visibleNodes, 4);
    assert.equal(data.truncated, true);
    assert.deepEqual(
      data.nodes.map((node: Record<string, unknown>) => [node.kind, node.name, node.note_count, node.project_count]),
      [
        ['tag', 'github-actions', 4, 2],
        ['tag', 'ci-cd', 2, 1],
        ['tag', 'deploy', 2, 1],
        ['tag', 'nodejs', 2, 1],
      ],
    );

    const visibleNodeIds = new Set(data.nodes.map((node: Record<string, unknown>) => node.id));
    assert.ok(data.edges.every((edge: Record<string, unknown>) => (
      visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    )));
    assert.deepEqual(
      data.edges.map((edge: Record<string, unknown>) => ({
        pair: [
          data.nodes.find((node: Record<string, unknown>) => node.id === edge.source).name,
          data.nodes.find((node: Record<string, unknown>) => node.id === edge.target).name,
        ],
        count: edge.cooccurrence_count,
        score: Number((edge.score as number).toFixed(3)),
        type: edge.type,
      })),
      [
        { pair: ['ci-cd', 'github-actions'], count: 2, score: 0.707, type: 'CO_OCCURS_WITH' },
        { pair: ['github-actions', 'nodejs'], count: 2, score: 0.707, type: 'CO_OCCURS_WITH' },
        { pair: ['ci-cd', 'nodejs'], count: 1, score: 0.5, type: 'CO_OCCURS_WITH' },
      ],
    );
  } finally {
    await app.close();
  }
});

test('GET /api/graph/projection level=tag filters by project and minimum score', async () => {
  const app = await createTagSeededApp();

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/graph/projection?level=tag&project=alpha&minScore=0.75&limit=20',
    });

    assert.equal(response.statusCode, 200);
    const data = response.json().data;
    assert.equal(data.truncated, false);
    assert.equal(data.stats.totalNodes, 4);
    assert.deepEqual(
      data.nodes.map((node: Record<string, unknown>) => [node.name, node.note_count, node.project_count]),
      [
        ['github-actions', 3, 1],
        ['ci-cd', 2, 1],
        ['nodejs', 2, 1],
        ['windows', 1, 1],
      ],
    );
    assert.deepEqual(
      data.edges.map((edge: Record<string, unknown>) => ({
        count: edge.cooccurrence_count,
        score: Number((edge.score as number).toFixed(3)),
      })),
      [
        { count: 2, score: 0.816 },
        { count: 2, score: 0.816 },
      ],
    );
  } finally {
    await app.close();
  }
});
