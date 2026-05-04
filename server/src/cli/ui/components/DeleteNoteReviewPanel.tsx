import React, { useCallback, useState } from 'react';
import { Box, Text } from 'ink';
import type { ExperienceReviewReason } from '@chatcrystal/shared';
import { useKeyboard, type KeyAction } from '../hooks/useKeyboard.js';
import { getLocale } from '../locale/index.js';

const REASONS: ExperienceReviewReason[] = [
  'not-experience',
  'low-value',
  'inaccurate',
  'duplicate',
  'other',
];

interface DeleteNoteReviewPanelProps {
  noteTitle?: string;
  error?: string | null;
  submitting?: boolean;
  onConfirm: (reason: ExperienceReviewReason) => void;
  onCancel: () => void;
}

export function DeleteNoteReviewPanel({
  noteTitle,
  error,
  submitting = false,
  onConfirm,
  onCancel,
}: DeleteNoteReviewPanelProps) {
  const [stage, setStage] = useState<'reason' | 'confirm'>('reason');
  const [cursor, setCursor] = useState(0);
  const [selectedReason, setSelectedReason] = useState<ExperienceReviewReason | null>(null);
  const t = getLocale();

  const handleAction = useCallback((action: KeyAction) => {
    if (submitting) return;

    switch (action) {
      case 'up':
        if (stage === 'reason') setCursor(prev => Math.max(0, prev - 1));
        break;
      case 'down':
        if (stage === 'reason') setCursor(prev => Math.min(REASONS.length - 1, prev + 1));
        break;
      case 'enter':
        if (stage === 'reason') {
          setSelectedReason(REASONS[cursor]);
          setStage('confirm');
        } else if (selectedReason) {
          onConfirm(selectedReason);
        }
        break;
      case 'escape':
      case 'quit':
        onCancel();
        break;
    }
  }, [cursor, onCancel, onConfirm, selectedReason, stage, submitting]);

  useKeyboard({ active: !submitting, onAction: handleAction });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>{t.deleteReviewTitle}</Text>
      {noteTitle && <Text dimColor>{noteTitle}</Text>}
      <Text> </Text>

      {stage === 'reason' ? (
        <>
          <Text>{t.deleteReviewReasonPrompt}</Text>
          {REASONS.map((reason, index) => (
            <Text key={reason} inverse={index === cursor}>
              {index === cursor ? ' ▸ ' : '   '}{t.deleteReviewReasonLabels[reason]}
            </Text>
          ))}
          <Text dimColor>{t.deleteReviewHintsReason}</Text>
        </>
      ) : (
        <>
          <Text>{t.deleteReviewConfirmPrompt}</Text>
          <Text>
            {t.deleteReviewReasonPrompt}: {selectedReason ? t.deleteReviewReasonLabels[selectedReason] : ''}
          </Text>
          <Text dimColor>{submitting ? t.deleteReviewDeleting : t.deleteReviewHintsConfirm}</Text>
        </>
      )}

      {error && <Text color="red">{t.deleteReviewError}: {error}</Text>}
    </Box>
  );
}
