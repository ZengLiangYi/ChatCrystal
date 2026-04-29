import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import { SCHEMA_SQL } from '../../db/schema.js';
import { writeTaskMemory } from './writeback.js';

async function createSqlDatabase() {
  const SQL = await initSqlJs({
    locateFile: (file) =>
      fileURLToPath(
        new URL(`../../../../node_modules/sql.js/dist/${file}`, import.meta.url),
      ),
  });
  const db = new SQL.Database();
  db.exec(SCHEMA_SQL);
  return db;
}

function insertImportedConversation(db: Pick<Database, 'run'>, id: string) {
  db.run(
    `INSERT INTO conversations (
      id, source, project_dir, project_name, cwd, git_branch, message_count,
      first_message_at, last_message_at, file_path, file_size, file_mtime, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      'codex',
      'C:/repo',
      'repo',
      'C:/repo',
      'main',
      1,
      '2026-04-15T00:00:00Z',
      '2026-04-15T00:00:00Z',
      `C:/repo/${id}.jsonl`,
      1,
      '2026-04-15T00:00:00Z',
      'summarized',
    ],
  );
}

function seedExistingNote(
  db: Database,
  {
    noteId,
    projectKey,
    outcomeType,
    raw,
    errorSignatures,
  }: {
    noteId: number;
    projectKey: string;
    outcomeType: string;
    raw: Record<string, unknown>;
    errorSignatures: string[];
  },
) {
  const conversationId = `conv-existing-${noteId}`;
  insertImportedConversation(db, conversationId);
  db.run(
    `INSERT INTO notes (
      id, conversation_id, title, summary, raw_llm_response, project_key, scope,
      source_type, source_agent, task_kind, error_signatures, files_touched, outcome_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      noteId,
      conversationId,
      'Existing memory',
      'Existing memory summary.',
      JSON.stringify(raw),
      projectKey,
      'project',
      'agent-writeback',
      'codex',
      'debug',
      JSON.stringify(errorSignatures),
      JSON.stringify([]),
      outcomeType,
    ],
  );
}

test('writeTaskMemory replays the same persisted decision for the same auto receipt key', async () => {
  const db = await createSqlDatabase();
  insertImportedConversation(db, 'conv-seed');

  const request = {
    mode: 'auto',
    source_run_key: 'run-123',
    task: {
      goal: 'Fix timeout',
      task_kind: 'debug',
      source_agent: 'codex',
      project_key: 'git:repo',
      project_dir: 'C:/repo',
      cwd: 'C:/repo',
      branch: 'main',
    },
    memory: {
      summary:
        'Await server readiness before requests so client calls do not race startup and fail with connection errors.',
      outcome_type: 'fix',
      root_cause: 'Requests raced the server startup',
      resolution: 'Await readiness in the helper',
      error_signatures: ['ECONNREFUSED'],
    },
  } as const;

  const first = await writeTaskMemory(request, {
    db: db as never,
    generateEmbeddings: async () => 1,
    semanticSearch: async () => [],
  });
  const second = await writeTaskMemory(request, {
    db: db as never,
    generateEmbeddings: async () => 1,
    semanticSearch: async () => [],
  });

  assert.equal(first.decision, 'created');
  assert.deepEqual(second, first);
});

test('writeTaskMemory stores manual writes as manual-note and respects explicit global scope', async () => {
  const db = await createSqlDatabase();

  const result = await writeTaskMemory(
    {
      mode: 'manual',
      scope: 'global',
      task: {
        goal: 'Capture the reusable readiness helper pattern',
        task_kind: 'implement',
        source_agent: 'unknown',
        project_key: 'git:repo',
        project_dir: 'C:/repo',
        cwd: 'C:/repo',
      },
      memory: {
        summary:
          'Reusable helper waits for server readiness before issuing requests.',
        outcome_type: 'pattern',
        reusable_patterns: [
          'Wrap client creation in a readiness helper before issuing requests.',
        ],
        resolution: 'Wrap client creation in a readiness helper.',
      },
    },
    {
      db: db as never,
      generateEmbeddings: async () => 1,
      semanticSearch: async () => [],
    },
  );

  const noteRows = db.exec(
    'SELECT scope, source_type FROM notes WHERE id = ?',
    [result.note_id],
  );
  const receiptRows = db.exec('SELECT COUNT(*) FROM writeback_receipts');

  assert.equal(result.decision, 'created');
  assert.equal(noteRows[0].values[0][0], 'global');
  assert.equal(noteRows[0].values[0][1], 'manual-note');
  assert.equal(Number(receiptRows[0].values[0][0]), 0);
});

test('writeTaskMemory persists tags for created memories', async () => {
  const db = await createSqlDatabase();

  const result = await writeTaskMemory(
    {
      mode: 'manual',
      task: {
        goal: 'Capture the reusable readiness helper pattern',
        task_kind: 'implement',
        source_agent: 'unknown',
        project_key: 'git:repo',
        project_dir: 'C:/repo',
        cwd: 'C:/repo',
      },
      memory: {
        summary:
          'Reusable helper waits for server readiness before issuing requests.',
        outcome_type: 'pattern',
        reusable_patterns: [
          'Wrap client creation in a readiness helper before issuing requests.',
        ],
        resolution: 'Wrap client creation in a readiness helper.',
        tags: ['testing', 'readiness'],
      },
    },
    {
      db: db as never,
      generateEmbeddings: async () => 1,
      semanticSearch: async () => [],
    },
  );

  const tagRows = db.exec(
    `SELECT t.name
       FROM note_tags nt
       JOIN tags t ON t.id = nt.tag_id
      WHERE nt.note_id = ?
      ORDER BY t.name ASC`,
    [result.note_id],
  );

  assert.deepEqual(
    (tagRows[0]?.values ?? []).map((row) => String(row[0])),
    ['readiness', 'testing'],
  );
});

test('writeTaskMemory re-embeds the merge target after appending evidence', async () => {
  const db = await createSqlDatabase();
  insertImportedConversation(db, 'conv-existing');
  db.run(
    `INSERT INTO notes (
      conversation_id, title, summary, raw_llm_response, project_key, scope, source_type, source_agent, task_kind, error_signatures, files_touched, outcome_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'conv-existing',
      'Timeout fix',
      'Existing timeout fix summary.',
      JSON.stringify({
        root_cause: 'Requests raced the server startup',
        resolution: 'Await readiness in the helper',
      }),
      'git:repo',
      'project',
      'imported-conversation',
      'codex',
      'debug',
      JSON.stringify(['ECONNREFUSED']),
      JSON.stringify([]),
      'fix',
    ],
  );
  const existingId = Number(
    db.exec('SELECT id FROM notes WHERE conversation_id = ?', ['conv-existing'])[0]
      .values[0][0],
  );
  const embedded: number[] = [];
  let saveCalls = 0;

  const result = await writeTaskMemory(
    {
      mode: 'auto',
      source_run_key: 'run-merge',
      task: {
        goal: 'Fix timeout',
        task_kind: 'debug',
        source_agent: 'codex',
        project_key: 'git:repo',
        project_dir: 'C:/repo',
        cwd: 'C:/repo',
        branch: 'main',
      },
      memory: {
        summary:
          'Await server readiness before requests so client calls do not race startup and fail with connection errors.',
        outcome_type: 'fix',
        root_cause: 'Requests raced the server startup',
        resolution: 'Await readiness in the helper',
        error_signatures: ['ECONNREFUSED'],
      },
    },
    {
      db: db as never,
      save: () => {
        saveCalls++;
      },
      generateEmbeddings: async (noteId: number) => {
        embedded.push(noteId);
        return 1;
      },
      semanticSearch: async () =>
        [
          {
            noteId: existingId,
            conversationId: 'conv-existing',
            title: 'Timeout fix',
            projectName: 'repo',
            score: 0.93,
            chunkText: 'timeout fix',
          },
        ] as never,
    },
  );

  assert.equal(result.decision, 'merged');
  assert.deepEqual(embedded, [existingId]);
});

test('writeTaskMemory merge preserves existing structured payload fields while adding new evidence', async () => {
  const db = await createSqlDatabase();
  insertImportedConversation(db, 'conv-merge-payload');
  db.run(
    `INSERT INTO notes (
      conversation_id, title, summary, key_conclusions, code_snippets, raw_llm_response, project_key, scope, source_type, source_agent, task_kind, error_signatures, files_touched, outcome_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'conv-merge-payload',
      'Timeout fix',
      'Existing timeout fix summary.',
      JSON.stringify(['Existing conclusion']),
      JSON.stringify([
        {
          language: 'ts',
          code: 'await waitForReady()',
          description: 'Existing snippet',
        },
      ]),
      JSON.stringify({
        root_cause: 'Requests raced the server startup',
        resolution: 'Await readiness in the helper',
        reusable_patterns: ['Existing helper'],
        pitfalls: ['Old pitfall'],
      }),
      'git:repo',
      'project',
      'imported-conversation',
      'codex',
      'debug',
      JSON.stringify(['ECONNREFUSED']),
      JSON.stringify(['tests/server.ts']),
      'fix',
    ],
  );
  const existingId = Number(
    db.exec('SELECT id FROM notes WHERE conversation_id = ?', ['conv-merge-payload'])[0]
      .values[0][0],
  );

  await writeTaskMemory(
    {
      mode: 'auto',
      source_run_key: 'run-merge-payload',
      task: {
        goal: 'Fix timeout',
        task_kind: 'debug',
        source_agent: 'codex',
        project_key: 'git:repo',
        project_dir: 'C:/repo',
        cwd: 'C:/repo',
      },
      memory: {
        summary:
          'Await server readiness before requests so client calls do not race startup and fail with connection errors.',
        outcome_type: 'fix',
        root_cause: 'Requests raced the server startup',
        resolution: 'Await readiness in the helper',
        error_signatures: ['ECONNREFUSED', 'ETIMEDOUT'],
        files_touched: ['tests/helper.ts'],
        key_conclusions: ['New conclusion'],
        code_snippets: [
          {
            language: 'ts',
            code: 'await helper.ready()',
            description: 'New snippet',
          },
        ],
        pitfalls: ['New pitfall'],
      },
    },
    {
      db: db as never,
      generateEmbeddings: async () => 1,
      semanticSearch: async () =>
        [
          {
            noteId: existingId,
            conversationId: 'conv-merge-payload',
            title: 'Timeout fix',
            projectName: 'repo',
            score: 0.93,
            chunkText: 'timeout fix',
          },
        ] as never,
    },
  );

  const rows = db.exec(
    'SELECT key_conclusions, code_snippets, error_signatures, files_touched, raw_llm_response FROM notes WHERE id = ?',
    [existingId],
  );
  const mergedPayload = JSON.parse(String(rows[0].values[0][4])) as {
    reusable_patterns?: string[];
    pitfalls?: string[];
    resolution?: string;
  };

  assert.deepEqual(JSON.parse(String(rows[0].values[0][0])), [
    'Existing conclusion',
    'New conclusion',
  ]);
  assert.deepEqual(JSON.parse(String(rows[0].values[0][1])), [
    {
      language: 'ts',
      code: 'await waitForReady()',
      description: 'Existing snippet',
    },
    {
      language: 'ts',
      code: 'await helper.ready()',
      description: 'New snippet',
    },
  ]);
  assert.deepEqual(JSON.parse(String(rows[0].values[0][2])), [
    'ECONNREFUSED',
    'ETIMEDOUT',
  ]);
  assert.deepEqual(JSON.parse(String(rows[0].values[0][3])), [
    'tests/server.ts',
    'tests/helper.ts',
  ]);
  assert.deepEqual(mergedPayload.reusable_patterns, ['Existing helper']);
  assert.deepEqual(mergedPayload.pitfalls, ['Old pitfall', 'New pitfall']);
  assert.equal(mergedPayload.resolution, 'Await readiness in the helper');
});

test('writeTaskMemory replay completes pending indexing before returning the stored auto decision', async () => {
  const db = await createSqlDatabase();
  db.run(
    `INSERT INTO writeback_receipts (
      source_agent, source_run_key, decision, note_id, merged_into_note_id, reason, index_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      'codex',
      'run-pending',
      'created',
      42,
      null,
      'created-new-memory',
      'pending',
    ],
  );
  const embedded: number[] = [];
  let saveCalls = 0;

  const result = await writeTaskMemory(
    {
      mode: 'auto',
      source_run_key: 'run-pending',
      task: {
        goal: 'Fix timeout',
        task_kind: 'debug',
        source_agent: 'codex',
      },
      memory: {
        summary: 'Await server readiness before requests.',
        outcome_type: 'fix',
      },
    },
    {
      db: db as never,
      save: () => {
        saveCalls++;
      },
      generateEmbeddings: async (noteId: number) => {
        embedded.push(noteId);
        return 1;
      },
      semanticSearch: async () => [],
    },
  );

  const receipt = db.exec(
    'SELECT index_status FROM writeback_receipts WHERE source_agent = ? AND source_run_key = ?',
    ['codex', 'run-pending'],
  );

  assert.equal(result.decision, 'created');
  assert.deepEqual(embedded, [42]);
  assert.equal(receipt[0].values[0][0], 'completed');
  assert.equal(saveCalls, 1);
});

test('writeTaskMemory merges root-cause-only fixes with matching existing memories', async () => {
  const db = await createSqlDatabase();
  seedExistingNote(db, {
    noteId: 77,
    projectKey: 'git:repo',
    outcomeType: 'fix',
    raw: {
      root_cause: 'Requests raced server startup',
      error_signatures: ['ECONNREFUSED'],
    },
    errorSignatures: ['ECONNREFUSED'],
  });

  const result = await writeTaskMemory(
    {
      mode: 'auto',
      source_run_key: 'run-root-cause-only',
      task: {
        goal: 'Fix ECONNREFUSED',
        task_kind: 'debug',
        source_agent: 'codex',
        project_key: 'git:repo',
      },
      memory: {
        summary:
          'Requests can race server startup and cause ECONNREFUSED during tests.',
        outcome_type: 'fix',
        root_cause: 'Requests raced server startup',
        error_signatures: ['ECONNREFUSED'],
      },
    },
    {
      db: db as never,
      generateEmbeddings: async () => 1,
      semanticSearch: async () => [
        {
          noteId: 77,
          conversationId: 'existing',
          title: 'Existing',
          projectName: 'repo',
          score: 0.92,
          chunkText: 'Existing',
        },
      ],
    },
  );

  assert.equal(result.decision, 'merged');
  assert.equal(result.merged_into_note_id, 77);
});

test('writeTaskMemory skips auto fix memories that lack root cause and resolution before semantic search', async () => {
  const db = await createSqlDatabase();
  let searchCalls = 0;
  let saveCalls = 0;

  const result = await writeTaskMemory(
    {
      mode: 'auto',
      source_run_key: 'run-low-fix',
      task: {
        goal: 'Fix flaky test',
        task_kind: 'debug',
        source_agent: 'codex',
        project_key: 'git:repo',
      },
      memory: {
        summary: 'Fixed a flaky test.',
        outcome_type: 'fix',
      },
    },
    {
      db: db as never,
      save: () => {
        saveCalls++;
      },
      generateEmbeddings: async () => 1,
      semanticSearch: async () => {
        searchCalls++;
        return [];
      },
    },
  );

  const receiptRows = db.exec(
    'SELECT decision, reason, index_status FROM writeback_receipts WHERE source_run_key = ?',
    ['run-low-fix'],
  );

  assert.equal(result.decision, 'skipped');
  assert.equal(result.reason, 'low-signal');
  assert.equal(searchCalls, 0);
  assert.equal(saveCalls, 1);
  assert.deepEqual(receiptRows[0].values[0], [
    'skipped',
    'low-signal',
    'completed',
  ]);
});

test('writeTaskMemory accepts concise fixes when structured fields carry the experience', async () => {
  const db = await createSqlDatabase();

  const result = await writeTaskMemory(
    {
      mode: 'auto',
      source_run_key: 'run-concise-fix',
      task: {
        goal: 'Fix ECONNREFUSED',
        task_kind: 'debug',
        source_agent: 'codex',
        project_key: 'git:repo',
        project_dir: 'C:/repo',
        cwd: 'C:/repo',
      },
      memory: {
        summary: 'Await readiness before requests.',
        outcome_type: 'fix',
        root_cause: 'Requests raced server startup.',
        resolution: 'Wait for server readiness before issuing requests.',
      },
    },
    {
      db: db as never,
      generateEmbeddings: async () => 1,
      semanticSearch: async () => [],
    },
  );

  assert.equal(result.decision, 'created');
  assert.equal(typeof result.note_id, 'number');
});

test('writeTaskMemory accepts valid pattern candidates and creates notes', async () => {
  const db = await createSqlDatabase();

  const result = await writeTaskMemory(
    {
      mode: 'auto',
      source_run_key: 'run-pattern',
      task: {
        goal: 'Add experience quality gate',
        task_kind: 'implement',
        source_agent: 'codex',
        project_key: 'git:repo',
        project_dir: 'C:/repo',
        cwd: 'C:/repo',
      },
      memory: {
        summary:
          'Core quality gates should validate agent writeback payloads before semantic merge so weak candidates cannot enter the experience library.',
        outcome_type: 'pattern',
        reusable_patterns: [
          'Put quality gates at trusted persistence boundaries before duplicate detection.',
        ],
      },
    },
    {
      db: db as never,
      generateEmbeddings: async () => 1,
      semanticSearch: async () => [],
    },
  );

  assert.equal(result.decision, 'created');
  assert.equal(typeof result.note_id, 'number');
});
