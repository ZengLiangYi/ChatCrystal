import { createHash } from 'node:crypto';
import type {
  ChatCrystalSource,
  ConversationMeta,
  ParsedConversation,
  RemoteImportItem,
} from '@chatcrystal/shared';

export const SUPPORTED_IMPORT_SOURCES: ChatCrystalSource[] = [
  'claude-code',
  'codex',
  'cursor',
  'trae',
  'copilot',
];

export function isChatCrystalSource(source: string): source is ChatCrystalSource {
  return SUPPORTED_IMPORT_SOURCES.includes(source as ChatCrystalSource);
}

export function namespaceConversationId(source: ChatCrystalSource, sourceConversationId: string): string {
  return sourceConversationId.startsWith(`${source}:`)
    ? sourceConversationId
    : `${source}:${sourceConversationId}`;
}

export function normalizeParsedConversationForRemote(
  source: ChatCrystalSource,
  sourceConversationId: string,
  parsed: ParsedConversation,
): ParsedConversation {
  const conversationId = namespaceConversationId(source, sourceConversationId);
  const idMap = new Map(parsed.messages.map((message) => [
    message.id,
    `${conversationId}:${message.id}`,
  ]));

  return {
    ...parsed,
    id: conversationId,
    source,
    messages: parsed.messages.map((message) => ({
      ...message,
      id: idMap.get(message.id) ?? `${conversationId}:${message.id}`,
      parentUuid: message.parentUuid ? (idMap.get(message.parentUuid) ?? `${conversationId}:${message.parentUuid}`) : null,
    })),
  };
}

export function computeConversationContentHash(parsed: ParsedConversation): string {
  const canonical = {
    source: parsed.source,
    messages: parsed.messages.map((message, index) => ({
      index,
      type: message.type,
      role: message.role,
      content: message.content,
      hasToolUse: message.hasToolUse,
      hasCode: message.hasCode,
      thinking: message.thinking,
    })),
  };

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function buildRemoteImportItem(
  source: ChatCrystalSource,
  meta: ConversationMeta,
  parsed: ParsedConversation,
  parserVersion = `${source}@1`,
): RemoteImportItem {
  const sourceConversationId = meta.id;
  const normalized = normalizeParsedConversationForRemote(source, sourceConversationId, parsed);

  return {
    source,
    sourceConversationId,
    conversationId: normalized.id,
    contentHash: computeConversationContentHash(normalized),
    parserVersion,
    meta: {
      ...meta,
      source,
      id: sourceConversationId,
    },
    parsed: normalized,
  };
}
