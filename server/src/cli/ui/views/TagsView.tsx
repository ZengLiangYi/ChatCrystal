import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { InteractiveList, type ColumnDef } from '../components/InteractiveList.js';
import { getLocale } from '../locale/index.js';
import type { CrystalClient } from '../../client.js';

interface TagItem {
  id: number;
  name: string;
  count: number;
}

interface TagsViewProps {
  client: CrystalClient;
  /** Called when user selects a tag → navigate to notes filtered by this tag */
  onSelectTag: (tagName: string) => void;
  onQuit: () => void;
}

export function TagsView({ client, onSelectTag, onQuit }: TagsViewProps) {
  const [tags, setTags] = useState<TagItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const t = getLocale();

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    client.listTags()
      .then(data => { setTags(data as TagItem[]); setLoading(false); })
      .catch(err => { setError(err instanceof Error ? err.message : String(err)); setLoading(false); });
  }, [client]);

  useEffect(() => { load(); }, [load]);

  const columns: ColumnDef[] = useMemo(() => [
    { header: t.tagsTitle, accessor: (tag: TagItem) => `#${tag.name}`, width: 30 },
    { header: t.headerNotes, accessor: (tag: TagItem) => tag.count, width: 8, align: 'right' as const },
  ], [t]);

  return (
    <InteractiveList<TagItem>
      items={tags}
      columns={columns}
      total={tags.length}
      loading={loading}
      error={error}
      hasMore={false}
      onLoadMore={() => {}}
      onSelect={(item) => onSelectTag(item.name)}
      onQuit={onQuit}
      onRetry={load}
      title={t.tagsTitle}
    />
  );
}
