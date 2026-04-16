import type { Database } from 'sql.js';

export function ensureSyntheticOriginConversation(
  db: Pick<Database, 'exec' | 'run'>,
  input: {
    originId: string;
    projectDir: string;
    projectName: string;
    cwd?: string | null;
    gitBranch?: string | null;
  },
) {
  const conversationId = `memory:${input.originId}`;
  const existing = db.exec('SELECT id FROM conversations WHERE id = ?', [
    conversationId,
  ]);
  if (existing[0]?.values.length) {
    return conversationId;
  }

  db.run(
    `INSERT INTO conversations (
      id, slug, source, project_dir, project_name, cwd, git_branch, message_count,
      first_message_at, last_message_at, file_path, file_size, file_mtime, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'), ?, 0, datetime('now'), 'summarized')`,
    [
      conversationId,
      null,
      'chatcrystal-memory',
      input.projectDir,
      input.projectName,
      input.cwd ?? null,
      input.gitBranch ?? null,
      `chatcrystal://memory/${input.originId}`,
    ],
  );

  return conversationId;
}
