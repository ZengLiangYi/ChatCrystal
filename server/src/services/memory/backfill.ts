import type { Database } from 'sql.js';
import type { SourceAgent } from '@chatcrystal/shared';
import { deriveProjectKey, resolveProjectIdentity } from './projectKey.js';

export function mapConversationSourceToAgent(source: string): SourceAgent {
  const normalized = String(source);
  if (normalized === 'codex') return 'codex';
  if (normalized === 'claude-code') return 'claude';
  if (normalized === 'copilot') return 'copilot';
  if (normalized === 'copilot-cli') return 'copilot';
  if (normalized === 'cursor') return 'cursor';
  if (normalized === 'trae') return 'trae';
  if (normalized === 'gemini') return 'gemini';
  if (normalized === 'qwen') return 'qwen';
  if (normalized === 'opencode') return 'opencode';
  if (normalized === 'cline') return 'cline';
  if (normalized === 'roo') return 'roo';
  if (normalized === 'kilo') return 'kilo';
  if (normalized === 'continue') return 'continue';
  if (normalized === 'dsh') return 'dsh';
  if (normalized === 'workbuddy') return 'workbuddy';
  if (normalized === 'antigravity') return 'antigravity';
  if (normalized === 'droid') return 'droid';
  if (normalized === 'goose') return 'goose';
  if (normalized === 'pi') return 'pi';
  if (normalized === 'omp') return 'omp';
  if (normalized === 'raft') return 'raft';
  if (normalized === 'cindy') return 'cindy';
  if (normalized === 'qoder') return 'qoder';
  if (normalized === 'qoder-cn') return 'qoder-cn';
  if (normalized === 'codebuddy') return 'codebuddy';
  if (normalized === 'claude-desktop') return 'claude-desktop';
  if (normalized === 'zcode') return 'zcode';
  if (normalized === 'hermes') return 'hermes';
  if (normalized === 'alma') return 'alma';
  if (normalized === 'grok') return 'grok';
  if (normalized === 'kimi') return 'kimi';
  if (normalized === 'minimax-code') return 'minimax-code';
  return 'unknown';
}

export function backfillImportedNoteMetadata(db: Pick<Database, 'exec' | 'run'>) {
  // Imported conversation notes only backfill fields that can be derived reliably.
  // task_kind / outcome_type / error_signatures / files_touched remain NULL until
  // a later explicit writeback or promotion flow assigns them.
  const result = db.exec(`
    SELECT n.id, n.project_key, c.source, c.project_dir, c.project_name, c.cwd
    FROM notes n
    JOIN conversations c ON c.id = n.conversation_id
    WHERE c.source != 'chatcrystal-memory'
      AND (
        n.project_key IS NULL
        OR n.source_type IS NULL
        OR n.source_agent IS NULL
        OR n.source_agent = 'unknown'
        OR n.scope IS NULL
      )
  `);

  for (const row of result[0]?.values ?? []) {
    const [noteId, existingProjectKey, source, projectDir, _projectName, cwd] =
      row as [number, string | null, string, string, string, string | null];
    const identity = resolveProjectIdentity({ projectDir, cwd });
    const canonicalKey = deriveProjectKey(identity);

    if (existingProjectKey && existingProjectKey !== canonicalKey) {
      db.run(
        'INSERT OR REPLACE INTO project_key_aliases (alias_key, canonical_key) VALUES (?, ?)',
        [existingProjectKey, canonicalKey],
      );
    }

    db.run(
      `UPDATE notes
         SET project_key = ?,
             scope = CASE
               WHEN scope IS NULL THEN 'project'
               ELSE scope
             END,
             source_type = CASE
               WHEN source_type IS NULL THEN 'imported-conversation'
               ELSE source_type
             END,
             source_agent = CASE
               WHEN source_agent IS NULL OR source_agent = 'unknown' THEN ?
               ELSE source_agent
             END
       WHERE id = ?`,
      [canonicalKey, mapConversationSourceToAgent(source), noteId],
    );
  }
}
