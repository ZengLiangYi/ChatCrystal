import type { ConversationMeta, ParsedConversation } from "@chatcrystal/shared";
import { appConfig } from "../config.js";
import { getDatabase, saveDatabase } from "../db/index.js";
import { withTransaction } from "../db/transaction.js";
import { getAdapter, getAllAdapters } from "../parser/index.js";
import { computeConversationContentHash } from "./importPayload.js";
import { enqueueNoteVectorCleanupTask } from "./vector-cleanup.js";

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
	const allAdapters = getAllAdapters();
	const enabledSources = appConfig.enabledSources;
	const adapters = allAdapters.filter((a) => enabledSources.includes(a.name));
	const allMetas: (ConversationMeta & { adapterName: string })[] = [];

	// Collect all conversation metadata from enabled sources
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
		currentFile: "",
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
				"SELECT file_size, file_mtime, content_hash FROM conversations WHERE id = ? AND source = ?",
				[meta.id, meta.source],
			);
			const existingRow = existing[0]?.values[0];

			if (existingRow) {
				const [existingSize, existingMtime] = existingRow;
				if (
					Number(existingSize) === meta.fileSize &&
					existingMtime === meta.fileMtime
				) {
					progress.skipped++;
					continue;
				}
			}

			// Parse the conversation
			const adapter = getAdapter(meta.adapterName);
			if (!adapter) {
				progress.errors++;
				continue;
			}

			const parsed = await adapter.parse(meta);
			const contentHash = computeConversationContentHash(parsed);
			const parserVersion = adapter.parserVersion ?? `${meta.adapterName}@1`;

			// Skip conversations with fewer than 2 meaningful messages
			if (parsed.messages.length < 2) {
				progress.skipped++;
				continue;
			}

			const existingContentHash =
				existingRow?.[2] === null || existingRow?.[2] === undefined
					? null
					: String(existingRow[2]);
			if (existingRow && existingContentHash === contentHash) {
				withTransaction(db, () => {
					updateImportedConversationMetadata(
						db,
						parsed,
						meta,
						contentHash,
						parserVersion,
					);
				});
				progress.skipped++;
				continue;
			}

			withTransaction(db, () => {
				if (existingRow) {
					replaceImportedConversation(db, parsed, meta, contentHash, parserVersion);
				} else {
					insertConversation(db, parsed, meta, contentHash, parserVersion);
					insertMessages(db, parsed);
				}

				db.run(
					`INSERT INTO import_log (file_path, status, message) VALUES (?, 'success', ?)`,
					[meta.filePath, `Imported ${parsed.messages.length} messages`],
				);
			});

			progress.imported++;
		} catch (err) {
			progress.errors++;
			const errorMsg = err instanceof Error ? err.message : "Unknown error";
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

function updateImportedConversationMetadata(
	db: ReturnType<typeof getDatabase>,
	parsed: ParsedConversation,
	meta: ConversationMeta,
	contentHash: string,
	parserVersion: string,
) {
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
		  WHERE id = ? AND source = ?`,
		[
			parsed.slug,
			meta.id,
			contentHash,
			parserVersion,
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
			parsed.id,
			parsed.source,
		],
	);
}

function deleteInvalidatedImportedNotes(
	db: ReturnType<typeof getDatabase>,
	conversationId: string,
) {
	const oldNoteIds =
		db
			.exec(
				`SELECT id FROM notes
				  WHERE conversation_id = ?
				    AND coalesce(is_edited, 0) = 0
				    AND coalesce(source_type, 'imported-conversation') = 'imported-conversation'`,
				[conversationId],
			)[0]
			?.values.map((note) => Number(note[0])) ?? [];

	for (const noteId of oldNoteIds) {
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

function hasNoteForConversation(
	db: ReturnType<typeof getDatabase>,
	conversationId: string,
) {
	const row = db.exec(
		'SELECT 1 FROM notes WHERE conversation_id = ? LIMIT 1',
		[conversationId],
	)[0]?.values[0];
	return Boolean(row);
}

function replaceImportedConversation(
	db: ReturnType<typeof getDatabase>,
	parsed: ParsedConversation,
	meta: ConversationMeta,
	contentHash: string,
	parserVersion: string,
) {
	const current = db.exec(
		`SELECT status, experience_score, experience_gate_reason, experience_gate_details
		   FROM conversations
		  WHERE id = ?`,
		[parsed.id],
	);
	const row = current[0]?.values[0];
	const status = row?.[0] === null || row?.[0] === undefined ? null : String(row[0]);
	const experienceScore =
		row?.[1] === null || row?.[1] === undefined ? null : Number(row[1]);
	const experienceGateReason =
		row?.[2] === null || row?.[2] === undefined ? null : String(row[2]);
	const experienceGateDetails =
		row?.[3] === null || row?.[3] === undefined ? null : String(row[3]);
	const keepUserRejectedGate =
		status === "filtered" && experienceGateReason === "user-rejected-note";

	deleteInvalidatedImportedNotes(db, parsed.id);
	const hasPreservedNote = hasNoteForConversation(db, parsed.id);
	db.run("DELETE FROM messages WHERE conversation_id = ?", [parsed.id]);
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
			parsed.source,
			meta.id,
			contentHash,
			parserVersion,
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
			keepUserRejectedGate ? "filtered" : hasPreservedNote ? "summarized" : "imported",
			keepUserRejectedGate ? experienceScore : null,
			keepUserRejectedGate ? experienceGateReason : null,
			keepUserRejectedGate ? experienceGateDetails : null,
			parsed.id,
		],
	);
	insertMessages(db, parsed);
}

function insertConversation(
	db: ReturnType<typeof getDatabase>,
	parsed: ParsedConversation,
	meta: ConversationMeta,
	contentHash: string,
	parserVersion: string,
) {
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
			parsed.source,
			meta.id,
			contentHash,
			parserVersion,
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
