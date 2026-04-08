import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { DetailView, type NoteDetail } from '../components/DetailView.js';
import { Spinner } from '../components/Spinner.js';
import { getLocale } from '../locale/index.js';
import type { CrystalClient } from '../../client.js';

interface NoteDetailViewProps {
  client: CrystalClient;
  noteId: number;
  /** For prev/next navigation */
  noteIds?: number[];
  currentIndex?: number;
  total?: number;
  onBack: () => void;
  /** Navigate to a different note by ID */
  onNavigate?: (noteId: number, index: number) => void;
}

export function NoteDetailView({
  client, noteId, noteIds, currentIndex, total, onBack, onNavigate,
}: NoteDetailViewProps) {
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [relations, setRelations] = useState<Array<{ id: number; title: string; relation_type: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const t = getLocale();

  // I2 fix: abort flag prevents stale responses on rapid prev/next navigation
  useEffect(() => {
    let cancelled = false;
    setNote(null);
    setError(null);

    Promise.all([
      client.getNote(noteId),
      client.getNoteRelations(noteId).catch(() => []),
    ]).then(([noteData, relData]) => {
      if (cancelled) return;
      setNote(noteData as NoteDetail);
      const mapped = relData.map(r => ({
        id: r.target_note_id === noteId ? r.source_note_id : r.target_note_id,
        title: (r.target_note_id === noteId ? r.source_title : r.target_title) || `#${r.target_note_id === noteId ? r.source_note_id : r.target_note_id}`,
        relation_type: r.relation_type,
      }));
      setRelations(mapped);
    }).catch(err => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : String(err));
    });

    return () => { cancelled = true; };
  }, [noteId, client]);

  // Allow Esc to go back even during loading/error states
  useInput((_input, key) => {
    if (key.escape || _input === 'q') {
      onBack();
    }
  }, { isActive: !note }); // Only active when DetailView's own handler isn't mounted

  if (error) {
    return (
      <Box paddingLeft={2} paddingTop={1}>
        <Text color="red">{t.loadFailed}: {error}</Text>
      </Box>
    );
  }

  if (!note) {
    return (
      <Box paddingLeft={2} paddingTop={1}>
        <Spinner label={`Loading note #${noteId}...`} />
      </Box>
    );
  }

  const position = currentIndex !== undefined && total !== undefined
    ? `${currentIndex + 1}/${total}` : undefined;

  const handlePrev = noteIds && currentIndex !== undefined && currentIndex > 0
    ? () => onNavigate?.(noteIds[currentIndex - 1], currentIndex - 1)
    : undefined;

  const handleNext = noteIds && currentIndex !== undefined && currentIndex < noteIds.length - 1
    ? () => onNavigate?.(noteIds[currentIndex + 1], currentIndex + 1)
    : undefined;

  return (
    <DetailView
      note={note}
      onBack={onBack}
      onPrev={handlePrev}
      onNext={handleNext}
      position={position}
      relations={relations}
    />
  );
}
