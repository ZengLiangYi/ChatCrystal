import React from 'react';
import { Text } from 'ink';

interface ProgressBarProps {
  current: number;
  total: number;
  width?: number;
}

export function ProgressBar({ current, total, width = 30 }: ProgressBarProps) {
  const ratio = total > 0 ? Math.min(current / total, 1) : 0;
  const filled = Math.round(width * ratio);
  const empty = width - filled;
  const pct = Math.round(ratio * 100);

  return (
    <Text>
      <Text color="green">{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(empty)}</Text>
      <Text> {pct}% ({current}/{total})</Text>
    </Text>
  );
}
