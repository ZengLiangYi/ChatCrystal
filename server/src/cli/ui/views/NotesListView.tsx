import React, { useCallback, useMemo, useState } from 'react';
import { Text } from 'ink';
import type { ExperienceReviewReason } from '@chatcrystal/shared';
import { InteractiveList, type ColumnDef } from '../components/InteractiveList.js';
import { DeleteNoteReviewPanel } from '../components/DeleteNoteReviewPanel.js';
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
  const [deleteTarget, setDeleteTarget] = useState<NoteItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchPage = useCallback(async (offset: number, limit: number) => {
    const data = await client.listNotes({ tag: tagFilter, offset, limit });
    return { items: data.items as NoteItem[], total: data.total };
  }, [client, tagFilter]);

  const { items, total, loading, error, hasMore, loadMore, reload, retry } = usePagination<NoteItem>({ fetchPage });

  const columns: ColumnDef[] = useMemo(() => [
    { header: 'ID', accessor: (n: NoteItem) => n.id, width: 5, align: 'right' as const },
    { header: t.headerTitle, accessor: (n: NoteItem) => n.title },
    { header: t.headerTags, accessor: (n: NoteItem) => (n.tags || []).slice(0, 3).join(', '), width: 20 },
    { header: t.headerCreated, accessor: (n: NoteItem) => n.created_at.slice(0, 10), width: 10 },
  ], [t]);

  const title = tagFilter ? `${t.notesTitle} [#${tagFilter}]` : t.notesTitle;

  const handleDelete = useCallback((item: NoteItem | null) => {
    if (!item) return;
    setDeleteTarget(item);
    setDeleteError(null);
  }, []);

  const handleConfirmDelete = useCallback((reason: ExperienceReviewReason) => {
    if (!deleteTarget || deleting) return;

    setDeleting(true);
    setDeleteError(null);
    client.deleteNote(deleteTarget.id, { reason, source: 'tui' })
      .then(() => {
        setDeleteTarget(null);
        reload();
      })
      .catch(err => {
        setDeleteError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setDeleting(false);
      });
  }, [client, deleteTarget, deleting, reload]);

  if (deleteTarget) {
    return (
      <DeleteNoteReviewPanel
        noteTitle={deleteTarget.title}
        error={deleteError}
        submitting={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          if (deleting) return;
          setDeleteTarget(null);
          setDeleteError(null);
        }}
      />
    );
  }

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
      onDelete={handleDelete}
      title={title}
      renderPreview={(item) => item.summary}
      renderSidePreview={(item, width) => {
        const w = width || 40;
        return (
          <>
            <Text bold>{truncate(item.title, w)}</Text>
            <Text dimColor>{truncate(`${t.tags}: ${(item.tags || []).map(tag => `#${tag}`).join(' ')}`, w)}</Text>
            <Text dimColor>{truncate(`${t.created}: ${item.created_at.slice(0, 10)}`, w)}</Text>
            <Text dimColor>{'─'.repeat(Math.min(w, 30))}</Text>
            {item.summary.split('\n').slice(0, 8).map((line, i) => (
              <Text key={i} dimColor>{truncate(line, w)}</Text>
            ))}
          </>
        );
      }}
    />
  );
}
