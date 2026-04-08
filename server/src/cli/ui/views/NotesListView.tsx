import React, { useCallback, useMemo } from 'react';
import { Text } from 'ink';
import { InteractiveList, type ColumnDef } from '../components/InteractiveList.js';
import { usePagination } from '../hooks/usePagination.js';
import { getLocale } from '../locale/index.js';
import { truncate } from '../../formatter.js';
import type { CrystalClient } from '../../client.js';

export interface NoteItem {
  id: number;
  title: string;
  summary: string;
  tags: string[];
  project_name?: string;
  created_at: string;
}

interface NotesListViewProps {
  client: CrystalClient;
  /** Pre-set tag filter (e.g., when navigating from tags view) */
  tagFilter?: string;
  /** Called when user selects a note */
  onSelectNote: (noteId: number, noteIndex: number) => void;
  /** Called when user triggers search */
  onSearch: () => void;
  /** Called when user quits */
  onQuit: () => void;
}

export function NotesListView({ client, tagFilter, onSelectNote, onSearch, onQuit }: NotesListViewProps) {
  const t = getLocale();

  const fetchPage = useCallback(async (offset: number, limit: number) => {
    const data = await client.listNotes({ tag: tagFilter, offset, limit });
    return { items: data.items as NoteItem[], total: data.total };
  }, [client, tagFilter]);

  const { items, total, loading, error, hasMore, loadMore, retry } = usePagination<NoteItem>({ fetchPage });

  const columns: ColumnDef[] = useMemo(() => [
    { header: 'ID', accessor: (n: NoteItem) => n.id, width: 5, align: 'right' as const },
    { header: t.headerTitle, accessor: (n: NoteItem) => truncate(n.title, 40), width: 42 },
    { header: t.headerTags, accessor: (n: NoteItem) => (n.tags || []).slice(0, 3).join(', '), width: 20 },
    { header: t.headerCreated, accessor: (n: NoteItem) => n.created_at.slice(0, 10), width: 10 },
  ], [t]);

  const title = tagFilter ? `${t.notesTitle} [#${tagFilter}]` : t.notesTitle;

  return (
    <InteractiveList<NoteItem>
      items={items}
      columns={columns}
      total={total}
      loading={loading}
      error={error}
      hasMore={hasMore}
      onLoadMore={loadMore}
      onSelect={(item, index) => onSelectNote(item.id, index)}
      onSearch={onSearch}
      onQuit={onQuit}
      onRetry={retry}
      title={title}
      renderPreview={(item) => item.summary}
      renderSidePreview={(item) => (
        <>
          <Text bold wrap="truncate">{item.title}</Text>
          <Text dimColor wrap="truncate">{t.tags}: {(item.tags || []).map(tag => `#${tag}`).join(' ')}</Text>
          <Text dimColor>{t.created}: {item.created_at.slice(0, 10)}</Text>
          <Text dimColor>{'─'.repeat(30)}</Text>
          <Text wrap="truncate-end">{truncate(item.summary, 200)}</Text>
        </>
      )}
    />
  );
}
