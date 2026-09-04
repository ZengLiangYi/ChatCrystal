import test from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import { SCHEMA_SQL } from '../../db/schema.js';
import { locateSqlJsFile } from '../../test-utils/sql.test-helper.js';
import { writeTaskMemory } from './writeback.js';

async function createSqlDatabase() {
  const SQL = await initSqlJs({
    locateFile: locateSqlJsFile,
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

const READINESS_TITLE = 'Server readiness race returns ECONNREFUSED';
const READINESS_SUMMARY =
  'Wait for Fastify readiness before issuing API requests to avoid startup race failures.';
const READINESS_ROOT_CAUSE =
  'Client calls hit ECONNREFUSED because they ran before the local server was ready.';
const READINESS_RESOLUTION =
  'Wait for the Fastify server readiness promise before issuing API requests.';
const READINESS_ECONNREFUSED = 'ECONNREFUSED before Fastify readiness';
const READINESS_ETIMEDOUT = 'ETIMEDOUT before Fastify readiness';
const READINESS_EXISTING_PITFALL =
  'Starting API requests before Fastify readiness lets client calls hit ECONNREFUSED during tests.';
const READINESS_INCOMING_PITFALL =
  'Do not issue HTTP requests before awaiting Fastify readiness because startup races return ECONNREFUSED.';
const READINESS_INCOMING_PATTERN =
  'Gate API request helpers on Fastify readiness before issuing HTTP calls.';
const READINESS_DECISION =
  'Wait for Fastify readiness before request setup because client calls return ECONNREFUSED when they race server startup.';

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
      title: READINESS_TITLE,
      summary: READINESS_SUMMARY,
      outcome_type: 'fix',
      root_cause: READINESS_ROOT_CAUSE,
      resolution: READINESS_RESOLUTION,
      error_signatures: [READINESS_ECONNREFUSED],
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

test('writeTaskMemory skips weak auto status records before semantic search', async () => {
  const db = await createSqlDatabase();
  let searchCalls = 0;
  let embedCalls = 0;
  let saveCalls = 0;

  const result = await writeTaskMemory(
    {
      mode: 'auto',
      source_run_key: 'run-status-snapshot',
      task: {
        goal: 'Record local package version status',
        task_kind: 'investigate',
        source_agent: 'codex',
        project_key: 'git:repo',
      },
      memory: {
        title: 'Persist local package version status',
        summary:
          'Persist checked current local package version status and generated dist output.',
        outcome_type: 'decision',
        decisions: [
          'Persist checked current local package version status and generated dist output.',
        ],
      },
    },
    {
      db: db as never,
      save: () => {
        saveCalls++;
      },
      generateEmbeddings: async () => {
        embedCalls++;
        return 1;
      },
      semanticSearch: async () => {
        searchCalls++;
        return [];
      },
    },
  );

  const noteCount = Number(db.exec('SELECT COUNT(*) FROM notes')[0].values[0][0]);
  const receiptRows = db.exec(
    'SELECT decision, reason, index_status FROM writeback_receipts WHERE source_run_key = ?',
    ['run-status-snapshot'],
  );

  assert.equal(result.decision, 'skipped');
  assert.equal(result.reason, 'low-note-quality');
  assert.ok(result.warnings.includes('one_off_status') || result.warnings.includes('durable_reusable_lesson'));
  assert.equal(searchCalls, 0);
  assert.equal(embedCalls, 0);
  assert.equal(saveCalls, 1);
  assert.equal(noteCount, 0);
  assert.deepEqual(receiptRows[0].values[0], [
    'skipped',
    'low-note-quality',
    'completed',
  ]);
});

test('writeTaskMemory persists materialized fields for created notes', async () => {
  const db = await createSqlDatabase();

  const result = await writeTaskMemory(
    {
      mode: 'auto',
      source_run_key: 'run-materialized-create',
      task: {
        goal: 'Fix server readiness race',
        task_kind: 'debug',
        source_agent: 'codex',
        project_key: 'git:repo',
        project_dir: 'C:/repo',
        cwd: 'C:/repo',
      },
      memory: {
        title: '  Server readiness race returns ECONNREFUSED  ',
        summary:
          'Wait for Fastify readiness\n before issuing API requests to avoid startup race failures.',
        outcome_type: 'fix',
        root_cause: READINESS_ROOT_CAUSE,
        resolution: READINESS_RESOLUTION,
      },
    },
    {
      db: db as never,
      generateEmbeddings: async () => 1,
      semanticSearch: async () => [],
    },
  );

  const noteRows = db.exec(
    'SELECT title, summary, key_conclusions, raw_llm_response FROM notes WHERE id = ?',
    [result.note_id],
  );
  const rawPayload = JSON.parse(String(noteRows[0].values[0][3])) as {
    key_conclusions?: string[];
    title?: string;
  };

  assert.equal(result.decision, 'created');
  assert.equal(noteRows[0].values[0][0], 'Server readiness race returns ECONNREFUSED');
  assert.equal(
    noteRows[0].values[0][1],
    'Wait for Fastify readiness before issuing API requests to avoid startup race failures.',
  );
  assert.deepEqual(JSON.parse(String(noteRows[0].values[0][2])), [
    `Root cause: ${READINESS_ROOT_CAUSE}`,
    `Resolution: ${READINESS_RESOLUTION}`,
  ]);
  assert.equal(rawPayload.title, '  Server readiness race returns ECONNREFUSED  ');
  assert.equal(rawPayload.key_conclusions, undefined);
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
      READINESS_TITLE,
      READINESS_SUMMARY,
      JSON.stringify({
        root_cause: READINESS_ROOT_CAUSE,
        resolution: READINESS_RESOLUTION,
      }),
      'git:repo',
      'project',
      'imported-conversation',
      'codex',
      'debug',
      JSON.stringify([READINESS_ECONNREFUSED]),
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
        title: READINESS_TITLE,
        summary: READINESS_SUMMARY,
        outcome_type: 'fix',
        root_cause: READINESS_ROOT_CAUSE,
        resolution: READINESS_RESOLUTION,
        error_signatures: [READINESS_ECONNREFUSED],
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
      READINESS_TITLE,
      READINESS_SUMMARY,
      JSON.stringify(['Existing conclusion']),
      JSON.stringify([
        {
          language: 'ts',
          code: 'await waitForReady()',
          description: 'Existing snippet',
        },
      ]),
      JSON.stringify({
        root_cause: READINESS_ROOT_CAUSE,
        resolution: READINESS_RESOLUTION,
        reusable_patterns: [
          'Wait for Fastify readiness before request setup so client calls cannot race server startup.',
        ],
        pitfalls: [READINESS_EXISTING_PITFALL],
      }),
      'git:repo',
      'project',
      'imported-conversation',
      'codex',
      'debug',
      JSON.stringify([READINESS_ECONNREFUSED]),
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
        title: READINESS_TITLE,
        summary: READINESS_SUMMARY,
        outcome_type: 'fix',
        root_cause: READINESS_ROOT_CAUSE,
        resolution: READINESS_RESOLUTION,
        error_signatures: [READINESS_ECONNREFUSED, READINESS_ETIMEDOUT],
        files_touched: ['tests/helper.ts'],
        reusable_patterns: [
          READINESS_INCOMING_PATTERN,
        ],
        decisions: [READINESS_DECISION],
        code_snippets: [
          {
            language: 'ts',
            code: "await fastify.ready();\nawait client.get('/api/status');",
            description:
              'Request helper waits for Fastify readiness before issuing API calls that otherwise hit ECONNREFUSED.',
          },
        ],
        pitfalls: [READINESS_INCOMING_PITFALL],
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
    'SELECT key_conclusions, code_snippets, error_signatures, files_touched, raw_llm_response, source_type FROM notes WHERE id = ?',
    [existingId],
  );
  const mergedPayload = JSON.parse(String(rows[0].values[0][4])) as {
    reusable_patterns?: string[];
    pitfalls?: string[];
    resolution?: string;
    decisions?: string[];
  };

  assert.equal(rows[0].values[0][5], 'agent-writeback');
  assert.deepEqual(JSON.parse(String(rows[0].values[0][0])), [
    'Existing conclusion',
    `Root cause: ${READINESS_ROOT_CAUSE}`,
    `Resolution: ${READINESS_RESOLUTION}`,
    `Pitfall: ${READINESS_EXISTING_PITFALL}`,
    `Pitfall: ${READINESS_INCOMING_PITFALL}`,
    'Pattern: Wait for Fastify readiness before request setup so client calls cannot race server startup.',
    `Pattern: ${READINESS_INCOMING_PATTERN}`,
    `Decision: ${READINESS_DECISION}`,
    `Error signature: ${READINESS_ECONNREFUSED}`,
    `Error signature: ${READINESS_ETIMEDOUT}`,
  ]);
  assert.deepEqual(JSON.parse(String(rows[0].values[0][1])), [
    {
      language: 'ts',
      code: 'await waitForReady()',
      description: 'Existing snippet',
    },
    {
      language: 'ts',
      code: "await fastify.ready();\nawait client.get('/api/status');",
      description:
        'Request helper waits for Fastify readiness before issuing API calls that otherwise hit ECONNREFUSED.',
    },
  ]);
  assert.deepEqual(JSON.parse(String(rows[0].values[0][2])), [
    READINESS_ECONNREFUSED,
    READINESS_ETIMEDOUT,
  ]);
  assert.deepEqual(JSON.parse(String(rows[0].values[0][3])), [
    'tests/server.ts',
    'tests/helper.ts',
  ]);
  assert.deepEqual(mergedPayload.reusable_patterns, [
    'Wait for Fastify readiness before request setup so client calls cannot race server startup.',
    READINESS_INCOMING_PATTERN,
  ]);
  assert.deepEqual(mergedPayload.decisions, [READINESS_DECISION]);
  assert.deepEqual(mergedPayload.pitfalls, [
    READINESS_EXISTING_PITFALL,
    READINESS_INCOMING_PITFALL,
  ]);
  assert.equal(mergedPayload.resolution, READINESS_RESOLUTION);
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

test('writeTaskMemory merges fixes with matching existing memories after preflight', async () => {
  const db = await createSqlDatabase();
  seedExistingNote(db, {
    noteId: 77,
    projectKey: 'git:repo',
    outcomeType: 'fix',
    raw: {
      root_cause: READINESS_ROOT_CAUSE,
      resolution: READINESS_RESOLUTION,
      error_signatures: [READINESS_ECONNREFUSED],
    },
    errorSignatures: [READINESS_ECONNREFUSED],
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
        title: READINESS_TITLE,
        summary: READINESS_SUMMARY,
        outcome_type: 'fix',
        root_cause: READINESS_ROOT_CAUSE,
        resolution: READINESS_RESOLUTION,
        error_signatures: [READINESS_ECONNREFUSED],
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
        title: READINESS_TITLE,
        summary: READINESS_SUMMARY,
        outcome_type: 'fix',
        root_cause: READINESS_ROOT_CAUSE,
        resolution: READINESS_RESOLUTION,
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
        goal: 'Normalize package metadata before dist comparison',
        task_kind: 'implement',
        source_agent: 'codex',
        project_key: 'git:repo',
        project_dir: 'C:/repo',
        cwd: 'C:/repo',
      },
      memory: {
        title: 'Normalize package metadata before dist comparison',
        summary:
          'Normalize package metadata before comparing generated dist output when version formats make dist comparisons unreliable.',
        outcome_type: 'pattern',
        reusable_patterns: [
          'Normalize package metadata before comparing generated dist output because inconsistent version formats made dist comparisons unreliable.',
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
