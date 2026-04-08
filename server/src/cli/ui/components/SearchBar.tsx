import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { getLocale } from '../locale/index.js';

interface SearchBarProps {
  onSubmit: (query: string) => void;
  onCancel: () => void;
  placeholder?: string;
  /** Initial value for the input */
  initialValue?: string;
}

/**
 * Search input bar. Captures all keyboard input while active.
 * Enter submits, Esc cancels, Backspace deletes.
 */
export function SearchBar({ onSubmit, onCancel, placeholder, initialValue = '' }: SearchBarProps) {
  const [value, setValue] = useState(initialValue);
  const t = getLocale();

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      if (value.trim()) {
        onSubmit(value.trim());
      }
      return;
    }
    if (key.backspace || key.delete) {
      setValue(prev => prev.slice(0, -1));
      return;
    }
    // Ignore control keys
    if (key.ctrl || key.meta) return;
    // Ignore arrow keys in search mode
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;

    // Append printable characters
    if (input && !key.tab) {
      setValue(prev => prev + input);
    }
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan" bold>🔍 </Text>
        <Text>{value}</Text>
        <Text color="gray">█</Text>
        {!value && placeholder && <Text dimColor> {placeholder}</Text>}
      </Box>
      <Text dimColor>  ({t.searchConfirm}, {t.searchCancel})</Text>
    </Box>
  );
}
