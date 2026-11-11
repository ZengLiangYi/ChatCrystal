/**
 * Disk-backed transcript cache.
 *
 * Parsing a conversation is the expensive part of an import, and the same
 * source file is parsed again on every pass (startup sync, watcher sync,
 * manual import, lazy detail load). This cache stores the `ParsedConversation`
 * of one source file, gzip-compressed, under the app data directory:
 *
 *   <dataDir>/transcript-cache/<source>/<sha1>.json.gz
 *
 * The key is a SHA-1 over everything that changes what a parse would return:
 * source, conversation id, parser version, file path, file size, file mtime
 * and `rootDir`. Any of them changing produces a new key, i.e. a miss, so a
 * cached entry can never be served for a file that has been edited or for a
 * parser whose contract changed.
 *
 * Layout rules:
 * - gzip via node:zlib, written to a temp file in the same folder and renamed
 *   into place, so a killed process never leaves a half-written entry that a
 *   later read would have to reject.
 * - every read/write failure is a miss for the caller: a broken gzip, a
 *   truncated file, a locked file on Windows or a read-only data directory
 *   only costs the parse, never the import.
 * - `CHATCRYSTAL_TRANSCRIPT_CACHE=off|0|false` disables reads and writes (the
 *   caller simply always parses); `CHATCRYSTAL_TRANSCRIPT_CACHE_DIR` overrides
 *   the folder.
 * - capacity is bounded by `CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_MB` (default 512)
 *   and `CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_AGE_DAYS` (default 30). Writes count
 *   towards a cheap estimate; every 20 writes, or as soon as the estimate
 *   passes the size limit, a background prune deletes entries by oldest file
 *   mtime until both limits hold again. Prune failures are silent.
 *
 * Import integration: check `readTranscriptCache(meta, parserVersion)` before
 * `adapter.parse(meta)` and call `writeTranscriptCache(meta, parserVersion,
 * parsed)` after a successful parse.
 */

import { createHash, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { Dirent } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import type {
	ConversationMeta,
	ParsedConversation,
} from "@chatcrystal/shared";
import { appConfig } from "../config.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** Fields that identify one cached parse (everything that invalidates it). */
export type TranscriptCacheMeta = Pick<
	ConversationMeta,
	"id" | "source" | "filePath" | "fileSize" | "fileMtime" | "rootDir"
>;

export interface TranscriptCacheStats {
	files: number;
	bytes: number;
}

/** Envelope stored inside each gzip file; bumped when the layout changes. */
const CACHE_FORMAT_VERSION = 1;

const DEFAULT_MAX_MB = 512;
const DEFAULT_MAX_AGE_DAYS = 30;
const PRUNE_EVERY_WRITES = 20;
const BYTES_PER_MB = 1024 * 1024;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const ENV_DISABLED = "CHATCRYSTAL_TRANSCRIPT_CACHE";
const ENV_DIR = "CHATCRYSTAL_TRANSCRIPT_CACHE_DIR";
const ENV_MAX_MB = "CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_MB";
const ENV_MAX_AGE_DAYS = "CHATCRYSTAL_TRANSCRIPT_CACHE_MAX_AGE_DAYS";

interface CacheEnvelope {
	version: number;
	key: string;
	parsed: ParsedConversation;
}

interface CacheFileInfo {
	filePath: string;
	size: number;
	mtimeMs: number;
}

let writesSincePrune = 0;
/** Rough size of the cache, seeded from the last prune and grown per write. */
let estimatedCacheBytes = 0;
/** The prune currently running, so concurrent writes do not start another. */
let activePrune: Promise<void> | null = null;
/** Warnings are emitted once per category, not once per broken file. */
const warned = new Set<string>();

function envValue(name: string): string {
	return (process.env[name] ?? "").trim();
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function warnOnce(category: string, message: string): void {
	if (warned.has(category)) return;
	warned.add(category);
	console.warn(message);
}

function isNotFound(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | null)?.code;
	return code === "ENOENT" || code === "ENOTDIR";
}

/** `off`, `0` and `false` (case-insensitive) turn the cache off. */
function isCacheDisabled(): boolean {
	const value = envValue(ENV_DISABLED).toLowerCase();
	return value === "off" || value === "0" || value === "false";
}

function cacheDirectory(): string {
	const override = envValue(ENV_DIR);
	if (override) return resolve(override);
	return join(appConfig.dataDir, "transcript-cache");
}

function positiveNumber(value: string, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function cacheLimits(): { maxBytes: number; maxAgeMs: number } {
	return {
		maxBytes: positiveNumber(envValue(ENV_MAX_MB), DEFAULT_MAX_MB) * BYTES_PER_MB,
		maxAgeMs:
			positiveNumber(envValue(ENV_MAX_AGE_DAYS), DEFAULT_MAX_AGE_DAYS) *
			MS_PER_DAY,
	};
}

/** A source id can only be a plain path segment inside the cache folder. */
function safeSourceSegment(source: string): string {
	const safe = source.replace(/[^a-zA-Z0-9._-]/g, "_");
	return safe && safe !== "." && safe !== ".." ? safe : "_";
}

/**
 * Cache key of one parse: SHA-1 of source, id, parser version, file path,
 * file size, file mtime and root dir joined by NUL bytes.
 */
function cacheKey(meta: TranscriptCacheMeta, parserVersion: string): string {
	const parts = [
		meta.source,
		meta.id,
		parserVersion,
		meta.filePath,
		String(meta.fileSize),
		meta.fileMtime,
		meta.rootDir ?? "",
	];
	return createHash("sha1").update(parts.join("\0")).digest("hex");
}

function cacheFilePath(
	meta: TranscriptCacheMeta,
	parserVersion: string,
): string {
	return join(
		cacheDirectory(),
		safeSourceSegment(meta.source),
		`${cacheKey(meta, parserVersion)}.json.gz`,
	);
}

function isCacheEnvelope(value: unknown): value is CacheEnvelope {
	if (!value || typeof value !== "object") return false;
	const envelope = value as Partial<CacheEnvelope>;
	if (envelope.version !== CACHE_FORMAT_VERSION) return false;
	const parsed = envelope.parsed;
	return (
		!!parsed &&
		typeof parsed === "object" &&
		typeof parsed.id === "string" &&
		Array.isArray(parsed.messages)
	);
}

/**
 * Read the cached parse of `meta`, or null on a miss. A miss covers "no cache
 * file", "cache disabled", and every unreadable/unparsable entry; the caller
 * should fall back to `adapter.parse(meta)`.
 */
export async function readTranscriptCache(
	meta: TranscriptCacheMeta,
	parserVersion: string,
): Promise<ParsedConversation | null> {
	if (isCacheDisabled()) return null;

	let compressed: Buffer;
	try {
		compressed = await readFile(cacheFilePath(meta, parserVersion));
	} catch (error) {
		if (!isNotFound(error)) {
			warnOnce(
				"read",
				`[TranscriptCache] cannot read a cache entry, ignoring it: ${errorMessage(error)}`,
			);
		}
		return null;
	}

	try {
		const json = await gunzipAsync(compressed);
		const envelope: unknown = JSON.parse(json.toString("utf-8"));
		return isCacheEnvelope(envelope) ? envelope.parsed : null;
	} catch (error) {
		warnOnce(
			"read",
			`[TranscriptCache] ignoring an unreadable cache entry: ${errorMessage(error)}`,
		);
		return null;
	}
}

/**
 * Store the parse of `meta`. Best effort: a failed write leaves the cache
 * without the entry (the next import writes it again) and never rejects.
 */
export async function writeTranscriptCache(
	meta: TranscriptCacheMeta,
	parserVersion: string,
	parsed: ParsedConversation,
): Promise<void> {
	if (isCacheDisabled()) return;

	try {
		const filePath = cacheFilePath(meta, parserVersion);
		const envelope: CacheEnvelope = {
			version: CACHE_FORMAT_VERSION,
			key: cacheKey(meta, parserVersion),
			parsed,
		};
		const compressed = await gzipAsync(
			Buffer.from(JSON.stringify(envelope), "utf-8"),
		);

		await mkdir(dirname(filePath), { recursive: true });
		// Write beside the target and rename, so a crash or a concurrent read
		// never sees a partially written gzip file.
		const tempPath = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
		try {
			await writeFile(tempPath, compressed);
			await rename(tempPath, filePath);
		} catch (error) {
			await rm(tempPath, { force: true }).catch(() => undefined);
			throw error;
		}

		noteCacheWrite(compressed.byteLength);
	} catch (error) {
		warnOnce(
			"write",
			`[TranscriptCache] cannot write a cache entry, continuing without it: ${errorMessage(error)}`,
		);
	}
}

/** Feed the write count/size estimate and start a prune when it is due. */
function noteCacheWrite(compressedBytes: number): void {
	writesSincePrune += 1;
	estimatedCacheBytes += compressedBytes;

	const { maxBytes } = cacheLimits();
	if (
		writesSincePrune >= PRUNE_EVERY_WRITES ||
		estimatedCacheBytes > maxBytes
	) {
		schedulePruneInBackground();
	}
}

function schedulePruneInBackground(): void {
	if (activePrune) return;
	// Fire and forget: imports must not wait for cache maintenance.
	void pruneTranscriptCache();
}

/** Every `*.json.gz` entry below the cache folder, with size and mtime. */
async function collectCacheFiles(dir: string): Promise<CacheFileInfo[]> {
	let sourceEntries: Dirent[];
	try {
		sourceEntries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const files: CacheFileInfo[] = [];
	for (const sourceEntry of sourceEntries) {
		if (!sourceEntry.isDirectory()) continue;
		const sourceDir = join(dir, sourceEntry.name);
		let entries: Dirent[];
		try {
			entries = await readdir(sourceDir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".json.gz")) continue;
			const filePath = join(sourceDir, entry.name);
			try {
				const fileStat = await stat(filePath);
				files.push({
					filePath,
					size: fileStat.size,
					mtimeMs: fileStat.mtimeMs,
				});
			} catch {
				// Removed between readdir and stat; nothing to account for.
			}
		}
	}
	return files;
}

/**
 * Delete cache entries until the size and age limits hold: expired entries
 * first, then the oldest remaining ones while the cache is over its size cap.
 * Never rejects; unreadable entries are simply left for the next prune.
 */
async function doPrune(): Promise<void> {
	try {
		const dir = cacheDirectory();
		const { maxBytes, maxAgeMs } = cacheLimits();
		const files = await collectCacheFiles(dir);
		if (files.length === 0) {
			writesSincePrune = 0;
			estimatedCacheBytes = 0;
			return;
		}

		const now = Date.now();
		let totalBytes = 0;
		for (const file of files) totalBytes += file.size;

		// Oldest first: expired entries go, then the cap is enforced from the
		// least recently written end.
		const ordered = [...files].sort((a, b) => a.mtimeMs - b.mtimeMs);
		for (const file of ordered) {
			const expired = now - file.mtimeMs > maxAgeMs;
			if (!expired && totalBytes <= maxBytes) continue;
			try {
				await unlink(file.filePath);
				totalBytes -= file.size;
			} catch {
				// A locked file (Windows) or one already gone: keep counting it
				// and let a later prune retry.
			}
		}

		writesSincePrune = 0;
		estimatedCacheBytes = Math.max(0, totalBytes);
	} catch {
		// Cache maintenance must never surface to a caller.
	}
}

/**
 * Prune the cache now. Used by tests and maintenance; writes schedule it in
 * the background on their own. Concurrent calls share the running prune.
 */
export function pruneTranscriptCache(): Promise<void> {
	if (!activePrune) {
		activePrune = doPrune().finally(() => {
			activePrune = null;
		});
	}
	return activePrune;
}

/** Number of cache entries and their total size on disk. */
export async function getTranscriptCacheStats(): Promise<TranscriptCacheStats> {
	const files = await collectCacheFiles(cacheDirectory());
	let bytes = 0;
	for (const file of files) bytes += file.size;
	return { files: files.length, bytes };
}

/**
 * Delete the whole cache folder, synchronously (called from config/clear
 * endpoints, where waiting is not wanted). Missing folders are fine.
 */
export function clearTranscriptCache(): void {
	try {
		rmSync(cacheDirectory(), { recursive: true, force: true });
	} catch {
		// Locked files on Windows stay behind; a later clear retries them.
	}
	writesSincePrune = 0;
	estimatedCacheBytes = 0;
}
