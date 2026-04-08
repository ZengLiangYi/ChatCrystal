import React, { useCallback, useMemo } from 'react';
import { InteractiveList, type ColumnDef } from '../components/InteractiveList.js';
import { usePagination } from '../hooks/usePagination.js';
import { getLocale } from '../locale/index.js';
import { truncate } from '../../formatter.js';
import type { CrystalClient } from '../../client.js';

export interface ConversationItem {
  id: string;
  source: string;
  project_name: string;
  status: string;
  message_count: number;
  last_message_at: string;
}

interface ConversationsViewProps {
  client: CrystalClient;
  source?: string;
  status?: string;
  search?: string;
  /** Called when user selects a conversation */
  onSelect: (conversation: ConversationItem) => void;
  onSearch: () => void;
  onQuit: () => void;
}

export function ConversationsView({ client, source, status, search, onSelect, onSearch, onQuit }: ConversationsViewProps) {
  const t = getLocale();

  const fetchPage = useCallback(async (offset: number, limit: number) => {
    const data = await client.getConversations({ source, status, search, offset, limit });
    return { items: data.items as ConversationItem[], total: data.total };
  }, [client, source, status, search]);

  const { items, total, loading, error, hasMore, loadMore, retry } = usePagination<ConversationItem>({ fetchPage });

  const columns: ColumnDef[] = useMemo(() => [
    { header: 'ID', accessor: (c: ConversationItem) => truncate(c.id, 12), width: 14 },
    { header: t.headerSource, accessor: (c: ConversationItem) => c.source, width: 12 },
    { header: t.headerProject, accessor: (c: ConversationItem) => truncate(c.project_name || '', 20), width: 22 },
    { header: t.headerMsgs, accessor: (c: ConversationItem) => c.message_count, width: 5, align: 'right' as const },
    { header: t.headerStatus, accessor: (c: ConversationItem) => c.status, width: 12 },
    { header: t.headerLastActive, accessor: (c: ConversationItem) => c.last_message_at ? new Date(c.last_message_at).toLocaleDateString() : '', width: 12 },
  ], [t]);

  return (
    <InteractiveList<ConversationItem>
      items={items}
      columns={columns}
      total={total}
      loading={loading}
      error={error}
      hasMore={hasMore}
      onLoadMore={loadMore}
      onSelect={(item) => onSelect(item)}
      onSearch={onSearch}
      onQuit={onQuit}
      onRetry={retry}
      title={t.conversationsTitle}
      renderPreview={(item) => `${item.source} | ${item.project_name} | ${item.message_count} msgs | ${item.status}`}
    />
  );
}
