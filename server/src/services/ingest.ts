import type {
  ChatCrystalSource,
  ParsedConversation,
  RemoteImportItem,
  RemoteImportItemResult,
  RemoteImportRequest,
  RemoteImportResponse,
} from '@chatcrystal/shared';
import type { Database } from 'sql.js';
import { getDatabase, saveDatabase } from '../db/index.js';
import { withTransaction } from '../db/transaction.js';
import {
  computeConversationContentHash,
  isChatCrystalSource,
  namespaceConversationId,
} from './importPayload.js';
import { enqueueNoteVectorCleanupTask } from './vector-cleanup.js';

type ExistingConversation = {
  id: string;
  contentHash: string | null;
  status: string | null;
  experienceScore: number | null;
  experienceGateReason: string | null;
  experienceGateDetails: string | null;
};

function validateItem(item: RemoteImportItem): asserts item is RemoteImportItem & { source: ChatCrystalSource } {
  if (!isChatCrystalSource(item.source)) {
    throw new Error(`Unsupported source: ${item.source}`);
  }
  if (!item.sourceConversationId?.trim()) {
    throw new Error('sourceConversationId is required');
  }
  const expectedConversationId = namespaceConversationId(item.source, item.sourceConversationId);
  if (item.conversationId !== expectedConversationId || item.parsed.id !== expectedConversationId) {
    throw new Error('Remote import item must use a server-verifiable namespaced conversation id');
  }
  if (item.parsed.source !== item.source) {
    throw new Error('Remote import item source does not match parsed conversation source');
  }
  if (!/^[a-f0-9]{64}$/.test(item.contentHash)) {
    throw new Error('Remote import item content hash must be a 64-character sha256 hex string');
  }
  if (item.parsed.messages.length < 2) {
    throw new Error('Remote import item must include at least two messages');
  }
  for (const message of item.parsed.messages) {
    if (!message.id.startsWith(`${expectedConversationId}:`)) {
      throw new Error('Remote import item message ids must be namespaced by conversation id');
    }
  }

  const expectedHash = computeConversationContentHash(item.parsed);
  if (item.contentHash !== expectedHash) {
    throw new Error('Remote import item content hash does not match parsed content');
  }
}

function readExistingConversation(
  db: Database,
  source: string,
  sourceConversationId: string,
): ExistingConversation | null {
  const namespacedConversationId = namespaceConversationId(source as ChatCrystalSource, sourceConversationId);
  const row = db.exec(
    `SELECT id, content_hash, status, experience_score, experience_gate_reason, experience_gate_details
       FROM conversations
      WHERE source = ?
        AND (
          source_conversation_id = ?
          OR id = ?
          OR id = ?
        )
      ORDER BY CASE
        WHEN source_conversation_id = ? THEN 0
        WHEN id = ? THEN 1
        ELSE 2
      END
      LIMIT 1`,
    [
      source,
      sourceConversationId,
      namespacedConversationId,
      sourceConversationId,
      sourceConversationId,
      namespacedConversationId,
    ],
  )[0]?.values[0];
  if (!row) return null;

  return {
    id: String(row[0]),
    contentHash: row[1] === null || row[1] === undefined ? null : String(row[1]),
    status: row[2] === null || row[2] === undefined ? null : String(row[2]),
    experienceScore: row[3] === null || row[3] === undefined ? null : Number(row[3]),
    experienceGateReason: row[4] === null || row[4] === undefined ? null : String(row[4]),
    experienceGateDetails: row[5] === null || row[5] === undefined ? null : String(row[5]),
  };
}

function parsedForStorage(parsed: ParsedConversation, conversationId: string): ParsedConversation {
  if (parsed.id === conversationId) return parsed;

  const oldPrefix = `${parsed.id}:`;
  const newPrefix = `${conversationId}:`;
  const idMap = new Map(parsed.messages.map((message, index) => {
    const nextId = message.id.startsWith(oldPrefix)
      ? `${newPrefix}${message.id.slice(oldPrefix.length)}`
      : `${newPrefix}${index}`;
    return [message.id, nextId];
  }));

  return {
    ...parsed,
    id: conversationId,
    messages: parsed.messages.map((message) => ({
      ...message,
      id: idMap.get(message.id) ?? `${newPrefix}${message.id}`,
      parentUuid: message.parentUuid ? (idMap.get(message.parentUuid) ?? null) : null,
    })),
  };
}

function deleteInvalidatedImportedNotes(db: Database, conversationId: string): void {
  const noteIds =
    db.exec(
      `SELECT id FROM notes
        WHERE conversation_id = ?
          AND coalesce(is_edited, 0) = 0
          AND coalesce(source_type, 'imported-conversation') = 'imported-conversation'`,
      [conversationId],
    )[0]?.values.map((row) => Number(row[0])) ?? [];

  for (const noteId of noteIds) {
    enqueueNoteVectorCleanupTask(noteId, { db });
  }

  db.run(
    `DELETE FROM notes
      WHERE conversation_id = ?
        AND coalesce(is_edited, 0) = 0
        AND coalesce(source_type, 'imported-conversation') = 'imported-conversation'`,
    [conversationId],
  );
}

function hasNoteForConversation(db: Database, conversationId: string): boolean {
  const row = db.exec(
    'SELECT 1 FROM notes WHERE conversation_id = ? LIMIT 1',
    [conversationId],
  )[0]?.values[0];
  return Boolean(row);
}

function updateConversationImportMetadata(
  db: Database,
  item: RemoteImportItem,
  conversationId: string,
): void {
  const parsed = parsedForStorage(item.parsed, conversationId);
  db.run(
    `UPDATE conversations
        SET slug = ?,
            source_conversation_id = ?,
            content_hash = ?,
            parser_version = ?,
            project_dir = ?,
            project_name = ?,
            cwd = ?,
            git_branch = ?,
            message_count = ?,
            first_message_at = ?,
            last_message_at = ?,
            file_path = ?,
            file_size = ?,
            file_mtime = ?,
            updated_at = datetime('now')
      WHERE id = ?`,
    [
      parsed.slug,
      item.sourceConversationId,
      item.contentHash,
      item.parserVersion,
      parsed.projectDir,
      parsed.projectName,
      parsed.cwd,
      parsed.gitBranch,
      parsed.messages.length,
      parsed.firstMessageAt,
      parsed.lastMessageAt,
      item.meta.filePath,
      item.meta.fileSize,
      item.meta.fileMtime,
      conversationId,
    ],
  );
}

function insertMessages(db: Database, parsed: ParsedConversation): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO messages (
      id, conversation_id, parent_uuid, type, role,
      content, has_tool_use, has_code, thinking, timestamp, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (let i = 0; i < parsed.messages.length; i++) {
    const message = parsed.messages[i];
    stmt.run([
      message.id,
      parsed.id,
      message.parentUuid,
      message.type,
      message.role,
      message.content,
      message.hasToolUse ? 1 : 0,
      message.hasCode ? 1 : 0,
      message.thinking,
      message.timestamp,
      i,
    ]);
  }

  stmt.free();
}

function insertConversation(db: Database, item: RemoteImportItem): void {
  const parsed = parsedForStorage(item.parsed, item.parsed.id);
  db.run(
    `INSERT INTO conversations (
      id, slug, source, source_conversation_id, content_hash, parser_version,
      project_dir, project_name, cwd, git_branch,
      message_count, first_message_at, last_message_at,
      file_path, file_size, file_mtime, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported')`,
    [
      parsed.id,
      parsed.slug,
      item.source,
      item.sourceConversationId,
      item.contentHash,
      item.parserVersion,
      parsed.projectDir,
      parsed.projectName,
      parsed.cwd,
      parsed.gitBranch,
      parsed.messages.length,
      parsed.firstMessageAt,
      parsed.lastMessageAt,
      item.meta.filePath,
      item.meta.fileSize,
      item.meta.fileMtime,
    ],
  );
  insertMessages(db, parsed);
}

function replaceConversation(db: Database, item: RemoteImportItem, existing: ExistingConversation): void {
  const parsed = parsedForStorage(item.parsed, existing.id);
  const keepUserRejectedGate =
    existing.status === 'filtered' && existing.experienceGateReason === 'user-rejected-note';

  deleteInvalidatedImportedNotes(db, existing.id);
  const hasPreservedNote = hasNoteForConversation(db, existing.id);
  db.run('DELETE FROM messages WHERE conversation_id = ?', [existing.id]);
  db.run(
    `UPDATE conversations
        SET slug = ?,
            source = ?,
            source_conversation_id = ?,
            content_hash = ?,
            parser_version = ?,
            project_dir = ?,
            project_name = ?,
            cwd = ?,
            git_branch = ?,
            message_count = ?,
            first_message_at = ?,
            last_message_at = ?,
            file_path = ?,
            file_size = ?,
            file_mtime = ?,
            status = ?,
            experience_score = ?,
            experience_gate_reason = ?,
            experience_gate_details = ?,
            updated_at = datetime('now')
      WHERE id = ?`,
    [
      parsed.slug,
      item.source,
      item.sourceConversationId,
      item.contentHash,
      item.parserVersion,
      parsed.projectDir,
      parsed.projectName,
      parsed.cwd,
      parsed.gitBranch,
      parsed.messages.length,
      parsed.firstMessageAt,
      parsed.lastMessageAt,
      item.meta.filePath,
      item.meta.fileSize,
      item.meta.fileMtime,
      keepUserRejectedGate ? 'filtered' : hasPreservedNote ? 'summarized' : 'imported',
      keepUserRejectedGate ? existing.experienceScore : null,
      keepUserRejectedGate ? existing.experienceGateReason : null,
      keepUserRejectedGate ? existing.experienceGateDetails : null,
      existing.id,
    ],
  );
  insertMessages(db, parsed);
}

function ingestOne(db: Database, item: RemoteImportItem): RemoteImportItemResult {
  validateItem(item);

  const existing = readExistingConversation(db, item.source, item.sourceConversationId);
  if (existing?.contentHash === item.contentHash) {
    withTransaction(db, () => {
      updateConversationImportMetadata(db, item, existing.id);
    });
    return {
      source: item.source,
      sourceConversationId: item.sourceConversationId,
      conversationId: existing.id,
      status: 'skipped',
    };
  }

  withTransaction(db, () => {
    if (existing) {
      replaceConversation(db, item, existing);
    } else {
      insertConversation(db, item);
    }
    db.run(
      `INSERT INTO import_log (file_path, status, message) VALUES (?, 'success', ?)`,
      [item.meta.filePath, `${existing ? 'Replaced' : 'Imported'} ${item.parsed.messages.length} remote messages`],
    );
  });

  return {
    source: item.source,
    sourceConversationId: item.sourceConversationId,
    conversationId: existing?.id ?? item.conversationId,
    status: existing ? 'replaced' : 'imported',
  };
}

export function ingestRemoteImport(request: RemoteImportRequest): RemoteImportResponse {
  if (request.version !== 1) {
    throw new Error('Unsupported remote import payload version');
  }

  const db = getDatabase();
  const items: RemoteImportItemResult[] = [];

  for (const item of request.items) {
    try {
      items.push(ingestOne(db, item));
    } catch (err) {
      const source = isChatCrystalSource(item.source) ? item.source : 'codex';
      items.push({
        source,
        sourceConversationId: item.sourceConversationId ?? '',
        conversationId: item.conversationId ?? '',
        status: 'error',
        error: err instanceof Error ? err.message : 'Remote import item failed',
      });
    }
  }

  saveDatabase();

  return {
    total: request.items.length,
    imported: items.filter((item) => item.status === 'imported').length,
    replaced: items.filter((item) => item.status === 'replaced').length,
    skipped: items.filter((item) => item.status === 'skipped').length,
    errors: items.filter((item) => item.status === 'error').length,
    items,
  };
}
