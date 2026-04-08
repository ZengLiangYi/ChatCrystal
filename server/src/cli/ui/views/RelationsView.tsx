import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { InteractiveList, type ColumnDef } from '../components/InteractiveList.js';
import { getLocale } from '../locale/index.js';
import { truncate } from '../../formatter.js';
import type { CrystalClient } from '../../client.js';

interface RelationItem {
  id: number;
  relatedNoteId: number;
  relation_type: string;
  title: string;
  confidence: number;
}

interface RelationsViewProps {
  client: CrystalClient;
  noteId: number;
  onSelectNote: (noteId: number, index: number) => void;
  onBack: () => void;
}

export function RelationsView({ client, noteId, onSelectNote, onBack }: RelationsViewProps) {
  const [relations, setRelations] = useState<RelationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const t = getLocale();

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    client.getNoteRelations(noteId)
      .then(data => {
        const mapped = data.map(r => ({
          id: r.id,
          relatedNoteId: r.target_note_id === noteId ? r.source_note_id : r.target_note_id,
          relation_type: r.relation_type,
          title: (r.target_note_id === noteId ? r.source_title : r.target_title) || `Note #${r.target_note_id === noteId ? r.source_note_id : r.target_note_id}`,
          confidence: r.confidence,
        }));
        setRelations(mapped);
        setLoading(false);
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [client, noteId]);

  useEffect(() => { load(); }, [load]);

  const columns: ColumnDef[] = useMemo(() => [
    { header: t.headerType, accessor: (r: RelationItem) => r.relation_type, width: 14 },
    { header: '#', accessor: (r: RelationItem) => r.relatedNoteId, width: 5 },
    { header: t.headerTitle, accessor: (r: RelationItem) => r.title },
    { header: t.headerConfidence, accessor: (r: RelationItem) => (r.confidence * 100).toFixed(0) + '%', width: 10 },
  ], [t]);

  return (
    <InteractiveList<RelationItem>
      items={relations}
      columns={columns}
      total={relations.length}
      loading={loading}
      error={error}
      hasMore={false}
      onLoadMore={() => {}}
      onSelect={(item, index) => onSelectNote(item.relatedNoteId, index)}
      onQuit={onBack}
      onRetry={load}
      title={`${t.relationsTitle} #${noteId}`}
    />
  );
}
