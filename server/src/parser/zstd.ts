/**
 * Generic zstd helpers for append-only JSONL logs.
 *
 * DeepSeek Harness (and some Codex rollouts) compress their logs as a sequence
 * of independent zstd frames — one frame per append batch — concatenated into a
 * single file. Node's synchronous zstd API only decodes the first frame of such
 * a buffer, so the frames have to be split apart before decompressing.
 *
 * Frame boundaries are found by parsing the zstd frame and block headers rather
 * than by scanning for the frame magic: the magic bytes can legitimately occur
 * inside a compressed block, and a magic scan would truncate that frame. When
 * the headers cannot be walked (typically because the final frame is still
 * being written), the decoder falls back to trying the next magic-byte
 * boundaries and finally the end of the buffer, which recovers the complete
 * prefix of a truncated frame.
 *
 * Kept free of adapter dependencies so other sources (Codex `.zst` rollouts)
 * can reuse it.
 */

import { readFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";

/** zstd frame magic number `28 B5 2F FD` (0xFD2FB528 little-endian). */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** Number of extra magic-byte boundaries probed before giving up on a frame. */
const MAX_BOUNDARY_ATTEMPTS = 3;

function startsWithZstdMagic(buf: Buffer): boolean {
	return (
		buf.length >= 4 &&
		buf[0] === 0x28 &&
		buf[1] === 0xb5 &&
		buf[2] === 0x2f &&
		buf[3] === 0xfd
	);
}

function hasZstdMagicAt(buf: Buffer, offset: number): boolean {
	return (
		offset + 4 <= buf.length &&
		buf[offset] === 0x28 &&
		buf[offset + 1] === 0xb5 &&
		buf[offset + 2] === 0x2f &&
		buf[offset + 3] === 0xfd
	);
}

/**
 * Whether a buffer starts with a zstd frame magic number.
 * A plain (uncompressed) JSONL buffer returns false.
 */
export function isZstd(buf: Buffer): boolean {
	return startsWithZstdMagic(buf);
}

/**
 * Walk one zstd frame's headers (frame header + block headers) and return the
 * offset just past its last block (and optional content checksum), or null when
 * the frame is incomplete/invalid and its end cannot be determined.
 */
function findFrameEnd(buf: Buffer, start: number): number | null {
	if (!hasZstdMagicAt(buf, start)) return null;
	let pos = start + 4;
	if (pos >= buf.length) return null;

	// Frame_Header_Descriptor
	const descriptor = buf[pos];
	pos += 1;
	const frameContentSizeFlag = descriptor >> 6;
	const singleSegment = (descriptor >> 5) & 1;
	const hasContentChecksum = ((descriptor >> 2) & 1) === 1;
	const reservedBit = (descriptor >> 3) & 1;
	const dictionaryIdFlag = descriptor & 3;
	if (reservedBit === 1) return null;

	// Window_Descriptor (absent for a single-segment frame)
	if (singleSegment === 0) {
		if (pos >= buf.length) return null;
		pos += 1;
	}

	// Dictionary_ID (0, 1, 2 or 4 bytes) and Frame_Content_Size
	const dictionaryIdSize = [0, 1, 2, 4][dictionaryIdFlag];
	pos += dictionaryIdSize;
	let frameContentSizeSize: number;
	if (frameContentSizeFlag === 0) frameContentSizeSize = singleSegment === 1 ? 1 : 0;
	else if (frameContentSizeFlag === 1) frameContentSizeSize = 2;
	else if (frameContentSizeFlag === 2) frameContentSizeSize = 4;
	else frameContentSizeSize = 8;
	pos += frameContentSizeSize;

	// Blocks: 3-byte little-endian header, then payload sized by the header.
	while (true) {
		if (pos + 3 > buf.length) return null;
		const blockHeader = buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16);
		pos += 3;
		const lastBlock = (blockHeader & 1) === 1;
		const blockType = (blockHeader >> 1) & 3;
		const blockSize = blockHeader >>> 3;
		if (blockType === 0) pos += blockSize; // Raw_Block
		else if (blockType === 1) pos += 1; // RLE_Block
		else if (blockType === 2) pos += blockSize; // Compressed_Block
		else return null; // reserved block type
		if (pos > buf.length) return null;
		if (lastBlock) break;
	}

	if (hasContentChecksum) pos += 4;
	if (pos > buf.length) return null;
	return pos;
}

interface DecodedFrame {
	data: Buffer;
	next: number;
}

/**
 * Decode the zstd frame starting at `start` and report where the next frame
 * begins. Returns null when no plausible frame can be decoded there, which also
 * covers magic bytes that are just payload data of a preceding frame.
 */
function decodeFrameAt(buf: Buffer, start: number): DecodedFrame | null {
	const exactEnd = findFrameEnd(buf, start);
	if (exactEnd !== null) {
		try {
			return {
				data: zstdDecompressSync(buf.subarray(start, exactEnd)),
				next: exactEnd,
			};
		} catch {
			// Fall through to the boundary heuristics below.
		}
	}

	// A truncated write or an unusual frame header: try the next magic-byte
	// boundaries, then the end of the buffer. Node returns the complete prefix
	// of a truncated frame instead of throwing, so the last attempt is the
	// best-effort recovery for a log that is still being appended to.
	let boundary = start;
	for (let attempt = 0; attempt < MAX_BOUNDARY_ATTEMPTS; attempt++) {
		const next = buf.indexOf(ZSTD_MAGIC, boundary + 4);
		if (next === -1) break;
		boundary = next;
		try {
			return {
				data: zstdDecompressSync(buf.subarray(start, boundary)),
				next: boundary,
			};
		} catch {
			// Keep extending; a false-positive magic inside this frame was skipped.
		}
	}

	try {
		return { data: zstdDecompressSync(buf.subarray(start)), next: buf.length };
	} catch {
		return null;
	}
}

/**
 * Decompress every zstd frame in a concatenated multi-frame buffer.
 *
 * Plain (non-zstd) buffers are returned unchanged. When the buffer starts with
 * a frame magic but not a single frame can be decoded, the input is returned as
 * well so callers can still attempt line-by-line recovery of a damaged file.
 */
export function decompressZstdFrames(buf: Buffer): Buffer {
	if (!isZstd(buf)) return buf;

	const parts: Buffer[] = [];
	let frames = 0;
	let pos = 0;
	while (pos + 4 <= buf.length) {
		const start = buf.indexOf(ZSTD_MAGIC, pos);
		if (start === -1) break;
		const frame = decodeFrameAt(buf, start);
		if (!frame) {
			// Skip the false positive and keep looking for the next real frame.
			pos = start + 4;
			continue;
		}
		parts.push(frame.data);
		frames++;
		pos = frame.next;
	}

	return frames > 0 ? Buffer.concat(parts) : buf;
}

/**
 * Read a file that may be zstd-compressed (multi-frame) or plain text and
 * return its decompressed UTF-8 contents.
 */
export async function readMaybeZstdFile(filePath: string): Promise<string> {
	const buf = await readFile(filePath);
	return isZstd(buf)
		? decompressZstdFrames(buf).toString("utf8")
		: buf.toString("utf8");
}
