import type {
  SourceInfo,
  ConversationMeta,
  ParsedConversation,
} from '@chatcrystal/shared';

/**
 * SourceAdapter — plugin interface for parsing conversations from different AI tools.
 *
 * To add a new data source, implement this interface and register it in the registry.
 */
export interface SourceAdapter {
  /** Unique identifier, e.g. 'claude-code' */
  readonly name: string;

  /** Display name shown in UI, e.g. 'Claude Code' */
  readonly displayName: string;

  /**
   * Detect if this data source is available on the current machine.
   * Returns source info if found, null otherwise.
   */
  detect(): Promise<SourceInfo | null>;

  /**
   * Scan the data directory for all conversation files.
   * Returns metadata (id, path, size, mtime) without parsing content.
   */
  scan(): Promise<ConversationMeta[]>;

  /**
   * Parse a single conversation file into structured data.
   * Should filter noise, extract content, and reconstruct thread order.
   */
  parse(meta: ConversationMeta): Promise<ParsedConversation>;
}
