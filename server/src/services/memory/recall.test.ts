import test from 'node:test';
import assert from 'node:assert/strict';
import { recallForTask } from './recall.js';
import { deriveProjectKey, resolveProjectIdentity } from './projectKey.js';

test('recallForTask returns project memories first and global memories second', async () => {
  const searchCalls: Array<{ topK: number; expandRelations: boolean }> = [];
  const db = {
    exec(sql: string, params: unknown[] = []) {
      if (sql.includes('SELECT canonical_key FROM project_key_aliases')) {
        return [{ columns: ['canonical_key'], values: [] }];
      }
      if (sql.includes('FROM project_key_aliases')) {
        return [{
          columns: ['alias_key'],
          values: [['path:legacy-project-a']],
        }];
      }
      if (sql.includes('FROM note_relations')) {
        return [{
          columns: ['source_note_id', 'target_note_id'],
          values: [
            [1, 11],
            [1, 12],
            [2, 21],
          ],
        }];
      }
      if (sql.includes('FROM notes')) {
        assert.deepEqual(params, [1, 2]);
        return [{
          columns: ['id', 'title', 'summary', 'project_key', 'scope', 'outcome_type', 'raw_llm_response'],
          values: [
            [1, 'Fix timeout', 'Canonical timeout fix summary', 'path:legacy-project-a', 'project', 'fix', JSON.stringify({
              pitfalls: ['Do not race startup'],
              reusable_patterns: ['Await readiness helper'],
            })],
            [2, 'Reusable readiness pattern', 'Canonical pattern summary', 'git:project-a', 'global', 'pattern', JSON.stringify({
              reusable_patterns: ['Await readiness helper'],
            })],
          ],
        }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const search = async (_query: string, topK: number, expandRelations: boolean) => {
    searchCalls.push({ topK, expandRelations });
    return [
      { noteId: 1, conversationId: 'conv-1', title: 'Fix timeout', projectName: 'repo', score: 0.92, chunkText: '' },
      { noteId: 2, conversationId: 'conv-2', title: 'Reusable readiness pattern', projectName: 'repo', score: 0.81, chunkText: 'await readiness' },
    ];
  };

  const result = await recallForTask(
    {
      mode: 'task',
      task: {
        goal: 'Fix flaky timeout',
        task_kind: 'debug',
        project_key: 'git:project-a',
      },
      options: {
        project_limit: 1,
        global_limit: 1,
        include_relations: false,
      },
    },
    { db: db as never, semanticSearch: search as never },
  );

  assert.deepEqual(result.project_memories.map((item) => item.note_id), [1]);
  assert.deepEqual(result.global_memories.map((item) => item.note_id), [2]);
  assert.equal(result.project_memories[0].summary, 'Canonical timeout fix summary');
  assert.deepEqual(result.project_memories[0].pitfalls, ['Do not race startup']);
  assert.deepEqual(result.project_memories[0].reusable_patterns, ['Await readiness helper']);
  assert.deepEqual(result.project_memories[0].related_note_ids, [11, 12]);
  assert.deepEqual(searchCalls, [{ topK: 6, expandRelations: false }]);
});

test('recallForTask returns no-matches when semantic hits are fully filtered out of the final pack', async () => {
  const db = {
    exec(sql: string) {
      if (sql.includes('SELECT canonical_key FROM project_key_aliases')) {
        return [{ columns: ['canonical_key'], values: [] }];
      }
      if (sql.includes('FROM project_key_aliases')) {
        return [{
          columns: ['alias_key'],
          values: [['git:project-a']],
        }];
      }
      if (sql.includes('FROM note_relations')) {
        return [{ columns: ['source_note_id', 'target_note_id'], values: [] }];
      }
      if (sql.includes('FROM notes')) {
        return [{
          columns: ['id', 'title', 'summary', 'project_key', 'scope', 'outcome_type', 'raw_llm_response'],
          values: [
            [9, 'Other project note', 'Other summary', 'git:other-project', 'project', 'fix', '{}'],
          ],
        }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const result = await recallForTask(
    {
      mode: 'task',
      task: {
        goal: 'Fix flaky timeout',
        task_kind: 'debug',
        project_key: 'git:project-a',
      },
      options: {
        project_limit: 1,
        global_limit: 0,
        include_relations: true,
      },
    },
    {
      db: db as never,
      semanticSearch: async () => [
        { noteId: 9, conversationId: 'conv-9', title: 'Other project note', projectName: 'other', score: 0.77, chunkText: 'other project' },
      ] as never,
    },
  );

  assert.equal(result.reason, 'no-matches');
  assert.deepEqual(result.project_memories, []);
  assert.deepEqual(result.global_memories, []);
});

test('recallForTask derives project_key from project_dir when the caller does not provide one', async () => {
  const projectDir = process.cwd().replace(/\\/g, '/');
  const derivedProjectKey = deriveProjectKey(
    resolveProjectIdentity({ projectDir, cwd: projectDir }),
  );
  const db = {
    exec(sql: string, params: unknown[] = []) {
      if (sql.includes('SELECT canonical_key FROM project_key_aliases')) {
        return [{ columns: ['canonical_key'], values: [] }];
      }
      if (sql.includes('FROM project_key_aliases')) {
        return [{
          columns: ['alias_key'],
          values: [[derivedProjectKey]],
        }];
      }
      if (sql.includes('FROM note_relations')) {
        return [{ columns: ['source_note_id', 'target_note_id'], values: [] }];
      }
      if (sql.includes('FROM notes')) {
        assert.deepEqual(params, [101]);
        return [{
          columns: ['id', 'title', 'summary', 'project_key', 'scope', 'outcome_type', 'raw_llm_response'],
          values: [
            [101, 'Derived project note', 'Derived summary', derivedProjectKey, 'project', 'fix', '{}'],
          ],
        }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const result = await recallForTask(
    {
      mode: 'task',
      task: {
        goal: 'Fix flaky timeout',
        task_kind: 'debug',
        project_dir: projectDir,
        cwd: projectDir,
      },
      options: {
        project_limit: 1,
        global_limit: 0,
        include_relations: false,
      },
    },
    {
      db: db as never,
      semanticSearch: async () => [
        {
          noteId: 101,
          conversationId: 'conv-101',
          title: 'Derived project note',
          projectName: 'repo',
          score: 0.88,
          chunkText: 'derived note',
        },
      ] as never,
    },
  );

  assert.equal(result.reason, 'ok');
  assert.equal(result.project_key, derivedProjectKey);
  assert.deepEqual(result.project_memories.map((item) => item.note_id), [101]);
});

test('recallForTask keeps the no-project-key reason when only global fallback memories are returned', async () => {
  const db = {
    exec(sql: string, params: unknown[] = []) {
      if (sql.includes('SELECT canonical_key FROM project_key_aliases')) {
        return [{ columns: ['canonical_key'], values: [] }];
      }
      if (sql.includes('FROM note_relations')) {
        return [{ columns: ['source_note_id', 'target_note_id'], values: [] }];
      }
      if (sql.includes('FROM notes')) {
        assert.deepEqual(params, [301]);
        return [{
          columns: ['id', 'title', 'summary', 'project_key', 'scope', 'outcome_type', 'raw_llm_response'],
          values: [
            [301, 'Reusable pattern', 'Global summary', 'git:any-project', 'global', 'pattern', JSON.stringify({
              reusable_patterns: ['Reuse the shared helper'],
            })],
          ],
        }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const result = await recallForTask(
    {
      mode: 'task',
      task: {
        goal: 'Fix flaky timeout',
        task_kind: 'debug',
      },
      options: {
        project_limit: 1,
        global_limit: 1,
        include_relations: false,
      },
    },
    {
      db: db as never,
      semanticSearch: async () => [
        {
          noteId: 301,
          conversationId: 'conv-301',
          title: 'Reusable pattern',
          projectName: 'shared',
          score: 0.83,
          chunkText: 'global summary',
        },
      ] as never,
    },
  );

  assert.equal(result.reason, 'no-project-key');
  assert.deepEqual(result.project_memories, []);
  assert.deepEqual(result.global_memories.map((item) => item.note_id), [301]);
});
