import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { useKeyboard, type KeyAction } from '../hooks/useKeyboard.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { StatusBar } from './StatusBar.js';
import { getLocale } from '../locale/index.js';

export interface NoteDetail {
  id: number;
  title: string;
  summary: string;
  key_conclusions: string[];
  code_snippets: Array<{ language: string; code: string; description: string }>;
  tags: string[];
  project_name: string;
  created_at: string;
}

interface DetailViewProps {
  note: NoteDetail;
  /** Called when Esc/q pressed */
  onBack: () => void;
  /** Called when ← pressed */
  onPrev?: () => void;
  /** Called when → pressed */
  onNext?: () => void;
  /** Position string like "2/243" */
  position?: string;
  /** Related notes to show at bottom */
  relations?: Array<{ id: number; title: string; relation_type: string }>;
}

/**
 * Full-screen note detail view with scrolling.
 * Shows title, metadata, summary, conclusions, code snippets, relations.
 */
export function DetailView({ note, onBack, onPrev, onNext, position, relations }: DetailViewProps) {
  const [scrollY, setScrollY] = useState(0);
  const { rows: termRows, columns: termCols } = useTerminalSize();
  const t = getLocale();

  // Build content lines
  const lines: Array<{ text: string; color?: string; bold?: boolean; dimColor?: boolean }> = [];

  // Title
  lines.push({ text: note.title, bold: true });
  // Metadata
  const tagsStr = note.tags.length > 0 ? note.tags.map(tag => `#${tag}`).join(' ') : '';
  lines.push({ text: `${t.tags}: ${tagsStr || '(none)'}   ${t.created}: ${note.created_at.slice(0, 10)}`, dimColor: true });
  lines.push({ text: `${t.project}: ${note.project_name || '(none)'}`, dimColor: true });
  lines.push({ text: '─'.repeat(Math.min(termCols - 2, 70)) });
  lines.push({ text: '' });

  // Summary
  lines.push({ text: `## ${t.summary}`, bold: true });
  for (const line of note.summary.split('\n')) {
    lines.push({ text: line });
  }
  lines.push({ text: '' });

  // Key conclusions
  if (note.key_conclusions.length > 0) {
    lines.push({ text: `## ${t.keyConclusions}`, bold: true });
    for (const c of note.key_conclusions) {
      lines.push({ text: `  • ${c}` });
    }
    lines.push({ text: '' });
  }

  // Code snippets
  if (note.code_snippets.length > 0) {
    lines.push({ text: `## ${t.codeSnippets}`, bold: true });
    for (const s of note.code_snippets) {
      lines.push({ text: `  [${s.language}] ${s.description}`, dimColor: true });
      for (const codeLine of s.code.split('\n')) {
        lines.push({ text: `    ${codeLine}` });
      }
      lines.push({ text: '' });
    }
  }

  // Relations
  if (relations && relations.length > 0) {
    lines.push({ text: `## ${t.relatedNotes}`, bold: true });
    for (const r of relations) {
      lines.push({ text: `  → ${r.title} (${r.relation_type})`, color: 'cyan' });
    }
  }

  // Viewport: status bar = 1 line, scroll indicator = 1 line (always reserve)
  const chromeLines = 2;
  const contentHeight = Math.max(1, termRows - chromeLines);
  const maxScroll = Math.max(0, lines.length - contentHeight);
  const visibleLines = lines.slice(scrollY, scrollY + contentHeight);

  const handleAction = useCallback((action: KeyAction) => {
    switch (action) {
      case 'up':
        setScrollY(prev => Math.max(0, prev - 1));
        break;
      case 'down':
        setScrollY(prev => Math.min(maxScroll, prev + 1));
        break;
      case 'left':
        onPrev?.();
        break;
      case 'right':
        onNext?.();
        break;
      case 'escape':
      case 'quit':
        onBack();
        break;
    }
  }, [maxScroll, onBack, onPrev, onNext]);

  useKeyboard({ onAction: handleAction });

  // Build hints
  const hints = [
    { key: 'Esc', label: t.hints.back.split(':')[1] },
  ];
  if (onPrev || onNext) {
    hints.push({ key: '←/→', label: t.hints.prevNext.split(':')[1] });
  }
  hints.push({ key: '↑↓', label: t.hints.scroll.split(':')[1] });

  return (
    <Box flexDirection="column" height={termRows}>
      {/* Content */}
      <Box flexDirection="column" flexGrow={1} paddingLeft={1} overflow="hidden">
        {visibleLines.map((line, i) => (
          <Text
            key={scrollY + i}
            bold={line.bold}
            dimColor={line.dimColor}
            color={line.color as any}
            wrap="truncate"
          >
            {line.text}
          </Text>
        ))}
      </Box>

      {/* Scroll indicator + Status bar */}
      {maxScroll > 0 ? (
        <Text dimColor> [{scrollY + 1}-{Math.min(scrollY + contentHeight, lines.length)}/{lines.length}]</Text>
      ) : (
        <Text> </Text>
      )}
      <StatusBar
        info={position ? `[${position}]` : undefined}
        hints={hints}
      />
    </Box>
  );
}
