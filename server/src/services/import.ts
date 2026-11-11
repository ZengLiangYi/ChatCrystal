import type {
	ConversationMeta,
	ImportBatchResult,
	ParsedConversation,
} from "@chatcrystal/shared";
import { appConfig } from "../config.js";
import { getDatabase, saveDatabase } from "../db/index.js";
import { withTransaction } from "../db/transaction.js";
import { getAdapter, getAllAdapters } from "../parser/index.js";
import { computeConversationContentHash } from "./importPayload.js";
import { createParsePool, type ParsePool } from "./parse-pool.js";
import { enqueueNoteVectorCleanupTask } from "./vector-cleanup.js";

let sharedParsePool: ParsePool | null = null;

/**
 * Whether this process should parse through the shared worker pool.
 *
 * The Node test runner registers fake adapters in-process that a worker cannot
 * see, so tests always parse inline. `CHATCRYSTAL_PARSE_POOL=off` (or `0`)
 * disables workers for debugging or constrained packaged runtimes.
 */
function shouldUseWorkerPool(): boolean {
	const flag = process.env.CHATCRYSTAL_PARSE_POOL?.trim().toLowerCase();
	if (flag === "off" || flag === "0" || flag === "false") return false;
	if (process.env.NODE_TEST_CONTEXT) return false;
	return true;
}

function getSharedParsePool(): ParsePool {
	sharedParsePool ??= createParsePool();
	return sharedParsePool;
}

/** Stop the process-wide parse pool (called on server shutdown). */
export async function closeSharedParsePool(): Promise<void> {
	const pool = sharedParsePool;
	sharedParsePool = null;
	await pool?.close();
}


export type ImportPhase =
	| "detecting"
	| "scanning"
	| "importing"
	| "done"
	| "cancelled";

export type ImportSourceStatus =
	| "pending"
	| "detecting"
	| "scanning"
	| "importing"
	| "done"
	| "error";

export interface ImportSourceProgress {
	source: string;
	displayName: string;
	status: ImportSourceStatus;
	found: number;
	processed: number;
	imported: number;
	replaced: number;
	skipped: number;
	errors: number;
	error?: string;
}

export interface ImportErrorDetail {
	source: string;
	filePath: string;
	message: string;
}

export interface ImportProgress extends ImportBatchResult {
	current: number;
	currentFile: string;
	phase: ImportPhase;
	sources: ImportSourceProgress[];
	errorsDetail: ImportErrorDetail[];
	durationMs: number;
	cancelled: boolean;
}

export type ProgressCallback = (progress: ImportProgress) => void;

/** Structural type of the worker-thread parse pool (see parse-pool.ts). */
export interface ParsePoolLike {
	parse(
		meta: ConversationMeta & { adapterName: string },
	): Promise<ParsedConversation>;
	close(): Promise<void>;
}

export interface ImportOptions {
	/** Only import the given source adapter names (default: all enabled). */
	sources?: string[];
	/** Abort between files; the import stops at the next boundary. */
	signal?: AbortSignal;
	onProgress?: ProgressCallback;
	/** Optional worker pool for parsing; falls back to in-process parsing. */
	parsePool?: ParsePoolLike | null;
}

const MAX_ERROR_DETAILS = 100;

function isProgressCallback(value: unknown): value is ProgressCallback {
	return typeof value === "function";
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : "Unknown error";
}

/**
 * Scan all registered sources and import new/changed conversations.
 *
 * Backwards compatible: `importAll(callback)` still works. Pass options to
 * restrict sources, observe phase/per-source progress, cancel with an
 * AbortSignal, or parse files in a worker pool.
 */
export async function importAll(
	onProgressOrOptions?: ProgressCallback | ImportOptions,
): Promise<ImportProgress> {
	const options: ImportOptions = isProgressCallback(onProgressOrOptions)
		? { onProgress: onProgressOrOptions }
		: (onProgressOrOptions ?? {});
	const onProgress = options.onProgress;
	const signal = options.signal;
	// Explicit `parsePool: null` forces in-process parsing; an explicit pool is
	// used as-is; the default is the process-wide worker pool (except in tests).
	const parsePool =
		options.parsePool !== undefined
			? options.parsePool
			: shouldUseWorkerPool()
				? getSharedParsePool()
				: null;
	const startedAt = Date.now();

	const enabledSources = appConfig.enabledSources;
	const requestedSources = options.sources
		? new Set(options.sources)
		: null;
	const adapters = getAllAdapters().filter(
		(adapter) =>
			enabledSources.includes(adapter.name) &&
			(!requestedSources || requestedSources.has(adapter.name)),
	);

	const progress: ImportProgress = {
		total: 0,
		current: 0,
		currentFile: "",
		phase: "detecting",
		sources: [],
		errorsDetail: [],
		durationMs: 0,
		cancelled: false,
		imported: 0,
		replaced: 0,
		skipped: 0,
		errors: 0,
		importedIds: [],
		replacedIds: [],
		skippedIds: [],
		errorIds: [],
		summarizationCandidateIds: [],
	};

	const sourceByName = new Map<string, ImportSourceProgress>();
	const ensureSource = (source: string, displayName: string) => {
		let entry = sourceByName.get(source);
		if (!entry) {
			entry = {
				source,
				displayName,
				status: "pending",
				found: 0,
				processed: 0,
				imported: 0,
				replaced: 0,
				skipped: 0,
				errors: 0,
			};
			sourceByName.set(source, entry);
			progress.sources.push(entry);
		}
		return entry;
	};
	const emit = () => {
		progress.durationMs = Date.now() - startedAt;
		onProgress?.(progress);
	};

	emit();

	const allMetas: (ConversationMeta & { adapterName: string })[] = [];

	// Collect metadata: detection and directory scans are cheap (stat + list).
	for (const adapter of adapters) {
		if (signal?.aborted) break;

		let info: Awaited<ReturnType<typeof adapter.detect>>;
		try {
			info = await adapter.detect();
		} catch (err) {
			const entry = ensureSource(adapter.name, adapter.displayName);
			entry.status = "error";
			entry.error = errorMessage(err);
			console.warn(`[Import] Failed to detect ${adapter.name}:`, entry.error);
			emit();
			continue;
		}
		if (!info) continue;

		const entry = ensureSource(adapter.name, adapter.displayName);
		entry.status = "scanning";
		emit();

		try {
			const metas = await adapter.scan();
			for (const meta of metas) {
				allMetas.push({ ...meta, adapterName: adapter.name });
			}
			entry.found = metas.length;
			entry.status = "importing";
		} catch (err) {
			entry.status = "error";
			entry.error = errorMessage(err);
			console.warn(`[Import] Failed to scan ${adapter.name}:`, entry.error);
		}
		emit();
	}

	progress.total = allMetas.length;
	progress.phase = signal?.aborted ? "cancelled" : "importing";
	progress.cancelled = Boolean(signal?.aborted);
	emit();

	const db = getDatabase();
	const remainingBySource = new Map<string, number>();
	for (const meta of allMetas) {
		remainingBySource.set(
			meta.source,
			(remainingBySource.get(meta.source) ?? 0) + 1,
		);
	}

	for (const meta of allMetas) {
		if (signal?.aborted) break;

		progress.current++;
		progress.currentFile = meta.filePath;
		emit();

		const outcome = await importConversationItem(db, meta, parsePool);
		const entry = sourceByName.get(meta.source);

		switch (outcome.status) {
			case "skipped":
				progress.skipped++;
				progress.skippedIds.push(outcome.id);
				if (entry) entry.skipped++;
				break;
			case "imported":
				progress.imported++;
				progress.importedIds.push(outcome.id);
				progress.summarizationCandidateIds.push(outcome.id);
				if (entry) entry.imported++;
				break;
			case "replaced":
				progress.replaced++;
				progress.replacedIds.push(outcome.id);
				if (outcome.priorStatus === "imported") {
					progress.summarizationCandidateIds.push(outcome.id);
				}
				if (entry) entry.replaced++;
				break;
			case "error":
				progress.errors++;
				progress.errorIds.push(outcome.id);
				if (progress.errorsDetail.length < MAX_ERROR_DETAILS) {
					progress.errorsDetail.push({
						source: meta.source,
						filePath: meta.filePath,
						message: outcome.message,
					});
				}
				if (entry) entry.errors++;
				break;
		}

		if (entry) {
			entry.processed++;
			const remaining = (remainingBySource.get(meta.source) ?? 0) - 1;
			remainingBySource.set(meta.source, remaining);
			if (remaining <= 0) entry.status = "done";
		}
		emit();
	}

	if (signal?.aborted) {
		progress.phase = "cancelled";
		progress.cancelled = true;
	} else {
		progress.phase = "done";
	}

	// Persist after batch import. sql.js serialized the whole database here;
	// node:sqlite checkpoints, so this stays cheap on the new backend.
	saveDatabase();

	console.log(
		`[Import] Done: ${progress.imported} imported, ${progress.replaced} replaced, ${progress.skipped} skipped, ${progress.errors} errors`,
	);
	emit();
	return progress;
}

type ImportItemOutcome =
	| { status: "skipped"; id: string }
	| { status: "imported"; id: string }
	| { status: "replaced"; id: string; priorStatus: string | null }
	| { status: "error"; id: string; message: string };

async function importConversationItem(
	db: ReturnType<typeof getDatabase>,
	meta: ConversationMeta & { adapterName: string },
	parsePool: ParsePoolLike | null,
): Promise<ImportItemOutcome> {
	// Check whether the conversation is already imported and unchanged.
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
			return { status: "skipped", id: meta.id };
		}
	}

	const adapter = getAdapter(meta.adapterName);
	if (!adapter) {
		return {
			status: "error",
			id: meta.id,
			message: `No adapter registered for ${meta.adapterName}`,
		};
	}

	try {
		const parsed = parsePool
			? await parsePool.parse(meta)
			: await adapter.parse(meta);
		const contentHash = computeConversationContentHash(parsed);
		const parserVersion =
			adapter.parserVersion ?? `${meta.adapterName}@1`;

		// Skip conversations with fewer than 2 meaningful messages.
		if (parsed.messages.length < 2) {
			return { status: "skipped", id: parsed.id };
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
			return { status: "skipped", id: parsed.id };
		}

		withTransaction(db, () => {
			if (existingRow) {
				replaceImportedConversation(
					db,
					parsed,
					meta,
					contentHash,
					parserVersion,
				);
			} else {
				insertConversation(db, parsed, meta, contentHash, parserVersion);
				insertMessages(db, parsed);
			}

			db.run(
				`INSERT INTO import_log (file_path, status, message) VALUES (?, 'success', ?)`,
				[meta.filePath, `Imported ${parsed.messages.length} messages`],
			);
		});

		if (existingRow) {
			return {
				status: "replaced",
				id: parsed.id,
				priorStatus: readConversationStatus(db, parsed.id),
			};
		}
		return { status: "imported", id: parsed.id };
	} catch (err) {
		const message = errorMessage(err);
		db.run(
			`INSERT INTO import_log (file_path, status, message) VALUES (?, 'error', ?)`,
			[meta.filePath, message],
		);
		console.error(`[Import] Error parsing ${meta.filePath}:`, message);
		return { status: "error", id: meta.id, message };
	}
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

function readConversationStatus(
	db: ReturnType<typeof getDatabase>,
	conversationId: string,
): string | null {
	const row = db.exec(
		'SELECT status FROM conversations WHERE id = ?',
		[conversationId],
	)[0]?.values[0];
	return row ? String(row[0]) : null;
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
