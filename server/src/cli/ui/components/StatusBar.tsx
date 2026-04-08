import React from 'react';
import { Box, Text } from 'ink';

export interface Hint {
  key: string;   // e.g., "↑↓"
  label: string; // e.g., "移动"
}

interface StatusBarProps {
  /** Left-side info text, e.g., "2/243" */
  info?: string;
  /** Keyboard shortcut hints */
  hints: Hint[];
}

/**
 * Fixed bottom status bar showing context info (left) and keyboard hints (right).
 */
export function StatusBar({ info, hints }: StatusBarProps) {
  const hintsText = hints.map(h => `${h.key}:${h.label}`).join('  ');

  return (
    <Box>
      {info && (
        <Text dimColor> {info} </Text>
      )}
      <Box flexGrow={1} />
      <Text dimColor>{hintsText} </Text>
    </Box>
  );
}
