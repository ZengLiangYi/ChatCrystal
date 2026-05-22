import type {
  ChatCrystalSource,
  RemoteImportItem,
  RemoteImportRequest,
  RemoteImportResponse,
} from '@chatcrystal/shared';
import { appConfig } from '../config.js';
import { getAdapter, getAllAdapters } from '../parser/index.js';
import type { SourceAdapter } from '../parser/adapter.js';
import {
  SUPPORTED_IMPORT_SOURCES,
  buildRemoteImportItem,
  isChatCrystalSource,
} from './importPayload.js';

export type RemoteImportCollectResult = {
  items: RemoteImportItem[];
  errors: number;
};

export type RemoteImportProgress = {
  scanned: number;
  uploaded: number;
  imported: number;
  replaced: number;
  skipped: number;
  errors: number;
};

export type RemoteImportResult = RemoteImportProgress & {
  localErrors: number;
};

type RemoteImportClient = {
  ingestConversations(request: RemoteImportRequest): Promise<RemoteImportResponse>;
};

const REMOTE_IMPORT_CHUNK_SIZE = 25;
const MAX_REMOTE_IMPORT_ITEM_BYTES = 8 * 1024 * 1024;
const MAX_REMOTE_IMPORT_BATCH_BYTES = 20 * 1024 * 1024;

export function validateRemoteImportSource(source: string): ChatCrystalSource {
  if (!isChatCrystalSource(source)) {
    throw new Error(`Unsupported source: ${source}. Expected one of: ${SUPPORTED_IMPORT_SOURCES.join(', ')}`);
  }
  return source;
}

function parserVersionFor(adapter: SourceAdapter): string {
  return adapter.parserVersion ?? `${adapter.name}@1`;
}

export function chunkRemoteImportItems(
  items: RemoteImportItem[],
  chunkSize = REMOTE_IMPORT_CHUNK_SIZE,
  maxBatchBytes = MAX_REMOTE_IMPORT_BATCH_BYTES,
): RemoteImportItem[][] {
  const chunks: RemoteImportItem[][] = [];
  let current: RemoteImportItem[] = [];

  for (const item of items) {
    const next = [...current, item];
    const nextBytes = Buffer.byteLength(JSON.stringify({ version: 1, items: next }), 'utf-8');
    if (current.length > 0 && (current.length >= chunkSize || nextBytes > maxBatchBytes)) {
      chunks.push(current);
      current = [item];
    } else {
      current = next;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

export function splitUploadableRemoteImportItems(items: RemoteImportItem[]): {
  uploadableItems: RemoteImportItem[];
  oversizedItems: RemoteImportItem[];
} {
  const uploadableItems: RemoteImportItem[] = [];
  const oversizedItems: RemoteImportItem[] = [];

  for (const item of items) {
    const bytes = Buffer.byteLength(JSON.stringify(item), 'utf-8');
    if (bytes > MAX_REMOTE_IMPORT_ITEM_BYTES) {
      oversizedItems.push(item);
    } else {
      uploadableItems.push(item);
    }
  }

  return { uploadableItems, oversizedItems };
}

export async function collectRemoteImportItems(options: { source?: string } = {}): Promise<RemoteImportCollectResult> {
  const sourceFilter = options.source ? validateRemoteImportSource(options.source) : undefined;
  const adapters = sourceFilter
    ? [getAdapter(sourceFilter)].filter(Boolean) as SourceAdapter[]
    : getAllAdapters().filter((adapter) =>
        appConfig.enabledSources.includes(adapter.name) &&
        isChatCrystalSource(adapter.name),
      );
  const items: RemoteImportItem[] = [];
  let errors = 0;

  for (const adapter of adapters) {
    const source = validateRemoteImportSource(adapter.name);
    try {
      const info = await adapter.detect();
      if (!info) continue;

      const metas = await adapter.scan();
      for (const meta of metas) {
        try {
          const parsed = await adapter.parse(meta);
          if (parsed.messages.length < 2) continue;
          items.push(buildRemoteImportItem(source, meta, parsed, parserVersionFor(adapter)));
        } catch (err) {
          errors++;
          console.error(`[RemoteImport] Error parsing ${meta.filePath}:`, err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      errors++;
      console.error(`[RemoteImport] Error scanning ${adapter.name}:`, err instanceof Error ? err.message : err);
    }
  }

  return { items, errors };
}

export async function runRemoteImport(
  client: RemoteImportClient,
  options: { source?: string } = {},
  onProgress?: (progress: RemoteImportProgress) => void,
): Promise<RemoteImportResult> {
  const collected = await collectRemoteImportItems(options);
  const { uploadableItems, oversizedItems } = splitUploadableRemoteImportItems(collected.items);
  const progress: RemoteImportResult = {
    scanned: collected.items.length,
    uploaded: 0,
    imported: 0,
    replaced: 0,
    skipped: 0,
    errors: collected.errors + oversizedItems.length,
    localErrors: collected.errors + oversizedItems.length,
  };

  onProgress?.(progress);

  for (const chunk of chunkRemoteImportItems(uploadableItems)) {
    const result = await client.ingestConversations({ version: 1, items: chunk });
    progress.uploaded += chunk.length;
    progress.imported += result.imported;
    progress.replaced += result.replaced;
    progress.skipped += result.skipped;
    progress.errors += result.errors;
    onProgress?.(progress);
  }

  return progress;
}
