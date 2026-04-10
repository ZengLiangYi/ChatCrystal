import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { InteractiveList, type ColumnDef } from '../components/InteractiveList.js';
import { usePagination } from '../hooks/usePagination.js';
import { getLocale } from '../locale/index.js';
import { truncate } from '../../formatter.js';
import type { CrystalClient } from '../../client.js';
import type { Hint } from '../components/StatusBar.js';

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
  /** Called when user selects a summarized conversation (to view its note) */
  onSelect: (conversation: ConversationItem) => void;
  onSearch: () => void;
  onQuit: () => void;
}

export function ConversationsView({ client, source, status, search, onSelect, onSearch, onQuit }: ConversationsViewProps) {
  const t = getLocale();
  const [summarizing, setSummarizing] = useState<string | null>(null);
  const [spinFrame, setSpinFrame] = useState(0);
  const spinChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  useEffect(() => {
    if (!summarizing) return;
    const timer = setInterval(() => setSpinFrame(prev => (prev + 1) % spinChars.length), 80);
    return () => clearInterval(timer);
  }, [summarizing]);

  const fetchPage = useCallback(async (offset: number, limit: number) => {
    const data = await client.getConversations({ source, status, search, offset, limit });
    return { items: data.items as ConversationItem[], total: data.total };
  }, [client, source, status, search]);

  const { items, total, loading, error, hasMore, loadMore, retry, reload } = usePagination<ConversationItem>({ fetchPage });

  const columns: ColumnDef[] = useMemo(() => [
    { header: 'ID', accessor: (c: ConversationItem) => truncate(c.id, 12), width: 14 },
    { header: t.headerSource, accessor: (c: ConversationItem) => c.source, width: 12 },
    { header: t.headerProject, accessor: (c: ConversationItem) => truncate(c.project_name || '', 20), width: 22 },
    { header: t.headerMsgs, accessor: (c: ConversationItem) => c.message_count, width: 5, align: 'right' as const },
    { header: t.headerStatus, accessor: (c: ConversationItem) => c.status, width: 12 },
    { header: t.headerLastActive, accessor: (c: ConversationItem) => c.last_message_at ? new Date(c.last_message_at).toLocaleDateString() : '', width: 12 },
  ], [t]);

  const handleSelect = useCallback((item: ConversationItem) => {
    if (item.status === 'summarized') {
      onSelect(item);
    }
    // Not summarized: do nothing on Enter, preview shows hint
  }, [onSelect]);

  const handleSummarize = useCallback(async (item: ConversationItem | null) => {
    if (!item || item.status === 'summarized' || summarizing) return;
    setSummarizing(item.id);
    try {
      await client.summarize(item.id);
      // Poll until status changes (summarization is async via queue)
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const data = await client.getConversations({ search: item.id, limit: 1 });
        const updated = data.items.find(c => c.id === item.id);
        if (updated && updated.status !== 'imported') {
          break;
        }
      }
      reload();
    } catch { /* ignore */ }
    finally { setSummarizing(null); }
  }, [client, summarizing, reload]);

  const extraHints: Hint[] = [{ key: 's', label: t.hints.summarize.split(':')[1] }];

  return (
    <InteractiveList<ConversationItem>
      items={items}
      columns={columns}
      total={total}
      loading={loading}
      error={error}
      hasMore={hasMore}
      onLoadMore={loadMore}
      onSelect={handleSelect}
      onSearch={onSearch}
      onQuit={onQuit}
      onRetry={retry}
      onSummarize={handleSummarize}
      extraHints={extraHints}
      title={t.conversationsTitle}
      renderPreview={(item) => {
        if (summarizing === item.id) return `${spinChars[spinFrame]} ${t.hints.summarize.split(':')[1]}...`;
        if (item.status === 'summarized') return `${item.source} | ${item.project_name} | ${item.message_count} msgs`;
        return `${t.notSummarized} — ${t.pressSToSummarize}`;
      }}
    />
  );
}
