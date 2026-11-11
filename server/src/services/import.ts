import type {
	ConversationMeta,
	ImportBatchResult,
	ParsedConversation,
} from "@chatcrystal/shared";
import type { Database, SqlValue } from "sql.js";
import { dirname } from "node:path";
import { appConfig } from "../config.js";
import { getDatabase, saveDatabase } from "../db/index.js";
import { withTransaction } from "../db/transaction.js";
import { getAdapter, getAllAdapters } from "../parser/index.js";
import { computeConversationContentHash } from "./importPayload.js";
import { createParsePool, type ParsePool } from "./parse-pool.js";
import {
	readTranscriptCache,
	writeTranscriptCache,
} from "./transcript-cache.js";
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

/** Readable fallback shown before an indexed conversation is materialized. */
function fallbackProjectName(displayName: string): string {
	return displayName || "Indexed conversation";
}

/**
 * Index-first: make a scanned conversation visible in the list without parsing
 * it yet. The row starts as `transcript_status = 'pending'`; the import loop (or
 * the detail page later) fills in the transcript and flips it to 'materialized'.
 * Columns already materialized by an earlier pass are left alone.
 */
function ensureIndexedConversation(
	db: ReturnType<typeof getDatabase>,
	meta: ConversationMeta,
	displayName: string,
): void {
	const existing = db.exec(
		"SELECT file_size, file_mtime, transcript_status FROM conversations WHERE id = ? AND source = ?",
		[meta.id, meta.source],
	);
	const row = existing[0]?.values[0];
	if (!row) {
		db.run(
			`INSERT INTO conversations (
				id, slug, source, source_conversation_id, parser_version,
				project_dir, project_name, message_count,
				first_message_at, last_message_at,
				file_path, file_size, file_mtime, root_dir, transcript_status
			) VALUES (?, NULL, ?, ?, NULL, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'pending')`,
			[
				meta.id,
				meta.source,
				meta.id,
				dirname(meta.filePath),
				fallbackProjectName(displayName),
				meta.fileMtime,
				meta.fileMtime,
				meta.filePath,
				meta.fileSize,
				meta.fileMtime,
				meta.rootDir ?? null,
			],
		);
		return;
	}

	if (Number(row[0]) === meta.fileSize && row[1] === meta.fileMtime) {
		return;
	}

	// The file changed: keep the row visible but mark the transcript stale so
	// the next pass (or the detail page) parses it again.
	db.run(
		`UPDATE conversations
		    SET file_path = ?, file_size = ?, file_mtime = ?, root_dir = ?,
		        transcript_status = 'pending', updated_at = datetime('now')
		  WHERE id = ? AND source = ?`,
		[
			meta.filePath,
			meta.fileSize,
			meta.fileMtime,
			meta.rootDir ?? null,
			meta.id,
			meta.source,
		],
	);
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
	const db = getDatabase();

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
			// Index-first: make every scanned conversation visible to the list
			// immediately (metadata only), then materialize its transcript below.
			withTransaction(db, () => {
				for (const meta of metas) {
					ensureIndexedConversation(db, meta, adapter.displayName);
					allMetas.push({ ...meta, adapterName: adapter.name });
				}
			});
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

export type MaterializeResult =
	| "materialized"
	| "skipped"
	| "missing"
	| "error";

/**
 * Ensure one conversation's transcript is materialized.
 *
 * Index-first syncs create rows from scan metadata only; the detail page and the
 * summarizer call this when `transcript_status` is still 'pending' (for example
 * after an interrupted sync, a changed file, or a cancelled pass). Parsing goes
 * through the transcript cache and the worker pool, exactly like a normal import.
 */
export async function materializeConversationById(
	conversationId: string,
	dbOverride?: Database,
): Promise<MaterializeResult> {
	const db = dbOverride ?? getDatabase();
	const result = db.exec(
		`SELECT id, source, source_conversation_id, file_path, file_size,
		        file_mtime, root_dir, transcript_status
		   FROM conversations
		  WHERE id = ?`,
		[conversationId],
	);
	const row = result[0]?.values[0];
	if (!row) return "missing";
	if (String(row[7] ?? "materialized") === "materialized") {
		return "materialized";
	}

	const source = String(row[1]);
	const adapter = getAdapter(source);
	if (!adapter) return "error";

	const meta: ConversationMeta & { adapterName: string } = {
		id: row[2] ? String(row[2]) : String(row[0]),
		source,
		filePath: String(row[3] ?? ""),
		fileSize: Number(row[4] ?? 0),
		fileMtime: String(row[5] ?? ""),
		projectDir: row[3] ? dirname(String(row[3])) : "",
		...(row[6] ? { rootDir: String(row[6]) } : {}),
		adapterName: source,
	};

	const outcome = await importConversationItem(
		db,
		meta,
		shouldUseWorkerPool() ? getSharedParsePool() : null,
	);
	saveDatabase();
	if (outcome.status === "error") return "error";
	if (outcome.status === "skipped") return "skipped";
	return "materialized";
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
	// Check whether the conversation is already materialized and unchanged.
	const existing = db.exec(
		`SELECT file_size, file_mtime, content_hash, transcript_status,
		        (SELECT COUNT(*) FROM messages WHERE conversation_id = conversations.id)
		   FROM conversations
		  WHERE id = ? AND source = ?`,
		[meta.id, meta.source],
	);
	let existingRow: SqlValue[] | undefined = existing[0]?.values[0];
	const rowPending =
		existingRow !== undefined &&
		String(existingRow[3] ?? "materialized") !== "materialized";
	const hasOldTranscript =
		existingRow !== undefined &&
		((existingRow[2] !== null &&
			existingRow[2] !== undefined &&
			String(existingRow[2]).trim() !== "") ||
			Number(existingRow[4] ?? 0) > 0);
	// A row created by the index pass (no content hash, no messages) is new;
	// a pending row that still holds an old transcript is a changed conversation.
	const indexOnly = rowPending && !hasOldTranscript;

	if (
		existingRow &&
		!rowPending &&
		Number(existingRow[0]) === meta.fileSize &&
		existingRow[1] === meta.fileMtime
	) {
		return { status: "skipped", id: meta.id };
	}

	const adapter = getAdapter(meta.adapterName);
	if (!adapter) {
		return {
			status: "error",
			id: meta.id,
			message: `No adapter registered for ${meta.adapterName}`,
		};
	}

	const parserVersion = adapter.parserVersion ?? `${meta.adapterName}@1`;

	try {
		let parsed: ParsedConversation | null =
			await readTranscriptCache(meta, parserVersion);
		if (!parsed) {
			parsed = parsePool
				? await parsePool.parse(meta)
				: await adapter.parse(meta);
			await writeTranscriptCache(meta, parserVersion, parsed);
		}

		// A parser may normalize the conversation id; drop the index-only row
		// under the scanned id so the materialized row is inserted once.
		if (existingRow && parsed.id !== meta.id) {
			if (indexOnly) {
				db.run(
					"DELETE FROM conversations WHERE id = ? AND source = ?",
					[meta.id, meta.source],
				);
				existingRow = undefined;
			} else {
				return {
					status: "error",
					id: parsed.id,
					message: `Conversation id changed from ${meta.id} to ${parsed.id}`,
				};
			}
		}

		const contentHash = computeConversationContentHash(parsed);

		// Index-only rows with too little content are dropped again so the list
		// keeps the same semantics as a full import.
		if (parsed.messages.length < 2) {
			if (indexOnly) {
				db.run(
					"DELETE FROM conversations WHERE id = ? AND source = ?",
					[meta.id, meta.source],
				);
			}
			return { status: "skipped", id: parsed.id };
		}

		const existingContentHash =
			existingRow?.[2] === null || existingRow?.[2] === undefined
				? null
				: String(existingRow[2]);
		// Same content: only skip when the stored transcript is actually there.
		// A pending row whose messages were dropped (or an index-only row that
		// already has a hash) still needs to write the parsed messages.
		if (
			existingRow &&
			existingContentHash === contentHash &&
			Number(existingRow[4] ?? 0) > 0
		) {
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

		// An index-only row created by this or an earlier scan is not an existing
		// conversation: replace it with the materialized row so the outcome counts
		// as an import, not as a replacement of a previous transcript.
		if (existingRow && indexOnly) {
			db.run(
				"DELETE FROM conversations WHERE id = ? AND source = ?",
				[meta.id, meta.source],
			);
			existingRow = undefined;
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
		        root_dir = ?,
		        transcript_status = 'materialized',
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
			meta.rootDir ?? null,
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
		        root_dir = ?,
		        transcript_status = 'materialized',
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
			meta.rootDir ?? null,
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
      file_path, file_size, file_mtime, root_dir, transcript_status, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'materialized', 'imported')`,
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
			meta.rootDir ?? null,
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
