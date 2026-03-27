import { getDatabase, saveDatabase } from '../db/index.js';
import { getAllAdapters, getAdapter } from '../parser/index.js';
import type { ConversationMeta, ParsedConversation } from '@chatcrystal/shared';

export interface ImportProgress {
  total: number;
  current: number;
  currentFile: string;
  imported: number;
  skipped: number;
  errors: number;
}

export type ProgressCallback = (progress: ImportProgress) => void;

/**
 * Scan all registered sources and import new/changed conversations.
 */
export async function importAll(
  onProgress?: ProgressCallback,
): Promise<ImportProgress> {
  const adapters = getAllAdapters();
  const allMetas: (ConversationMeta & { adapterName: string })[] = [];

  // Collect all conversation metadata from all sources
  for (const adapter of adapters) {
    const info = await adapter.detect();
    if (!info) continue;

    const metas = await adapter.scan();
    for (const meta of metas) {
      allMetas.push({ ...meta, adapterName: adapter.name });
    }
  }

  const progress: ImportProgress = {
    total: allMetas.length,
    current: 0,
    currentFile: '',
    imported: 0,
    skipped: 0,
    errors: 0,
  };

  const db = getDatabase();

  for (const meta of allMetas) {
    progress.current++;
    progress.currentFile = meta.filePath;
    onProgress?.(progress);

    try {
      // Check if already imported and unchanged
      const existing = db.exec(
        'SELECT file_size, file_mtime FROM conversations WHERE id = ? AND source = ?',
        [meta.id, meta.source],
      );

      if (existing.length > 0 && existing[0].values.length > 0) {
        const [existingSize, existingMtime] = existing[0].values[0];
        if (
          Number(existingSize) === meta.fileSize &&
          existingMtime === meta.fileMtime
        ) {
          progress.skipped++;
          continue;
        }
        // File changed — delete old data and re-import
        db.run(`DELETE FROM conversations WHERE id = ?`, [meta.id]);
      }

      // Parse the conversation
      const adapter = getAdapter(meta.adapterName);
      if (!adapter) {
        progress.errors++;
        continue;
      }

      const parsed = await adapter.parse(meta);

      // Skip conversations with fewer than 2 meaningful messages
      if (parsed.messages.length < 2) {
        progress.skipped++;
        continue;
      }

      // Insert conversation
      insertConversation(db, parsed, meta);

      // Insert messages
      insertMessages(db, parsed);

      progress.imported++;

      // Log import
      db.run(
        `INSERT INTO import_log (file_path, status, message) VALUES (?, 'success', ?)`,
        [meta.filePath, `Imported ${parsed.messages.length} messages`],
      );
    } catch (err) {
      progress.errors++;
      const errorMsg =
        err instanceof Error ? err.message : 'Unknown error';
      db.run(
        `INSERT INTO import_log (file_path, status, message) VALUES (?, 'error', ?)`,
        [meta.filePath, errorMsg],
      );
      console.error(`[Import] Error parsing ${meta.filePath}:`, errorMsg);
    }
  }

  // Persist after batch import
  saveDatabase();

  console.log(
    `[Import] Done: ${progress.imported} imported, ${progress.skipped} skipped, ${progress.errors} errors`,
  );
  return progress;
}

function insertConversation(
  db: ReturnType<typeof getDatabase>,
  parsed: ParsedConversation,
  meta: ConversationMeta,
) {
  db.run(
    `INSERT INTO conversations (
      id, slug, source, project_dir, project_name, cwd, git_branch,
      message_count, first_message_at, last_message_at,
      file_path, file_size, file_mtime, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported')`,
    [
      parsed.id,
      parsed.slug,
      parsed.source,
      parsed.projectDir,
      parsed.projectName,
      parsed.cwd,
      parsed.gitBranch,
      parsed.messages.length,
      parsed.firstMessageAt,
      parsed.lastMessageAt,
      meta.filePath,
      meta.fileSize,
      meta.fileMtime,
    ],
  );
}

function insertMessages(
  db: ReturnType<typeof getDatabase>,
  parsed: ParsedConversation,
) {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO messages (
      id, conversation_id, parent_uuid, type, role,
      content, has_tool_use, has_code, thinking, timestamp, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (let i = 0; i < parsed.messages.length; i++) {
    const msg = parsed.messages[i];
    stmt.run([
      msg.id,
      parsed.id,
      msg.parentUuid,
      msg.type,
      msg.role,
      msg.content,
      msg.hasToolUse ? 1 : 0,
      msg.hasCode ? 1 : 0,
      msg.thinking,
      msg.timestamp,
      i,
    ]);
  }

  stmt.free();
}
