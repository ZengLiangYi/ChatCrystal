import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useKeyboard, type KeyAction } from '../hooks/useKeyboard.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { StatusBar, type Hint } from './StatusBar.js';
import { getLocale } from '../locale/index.js';
import { truncate, displayWidth } from '../../formatter.js';

export interface ColumnDef {
  /** Header label */
  header: string;
  /** Function to extract cell value from item */
  accessor: (item: any) => string | number;
  /** Fixed width in columns. If omitted, auto-calculated. */
  width?: number;
  /** Right-align numeric columns */
  align?: 'left' | 'right';
}

interface InteractiveListProps<T> {
  items: T[];
  columns: ColumnDef[];
  total: number;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  /** Called when user scrolls near the bottom */
  onLoadMore: () => void;
  /** Called when user presses Enter on an item */
  onSelect: (item: T, index: number) => void;
  /** Called when user presses / for search */
  onSearch?: () => void;
  /** Called when user presses q to quit */
  onQuit: () => void;
  /** Called when user presses r to retry */
  onRetry?: () => void;
  /** Render inline preview for selected item (narrow mode) */
  renderPreview?: (item: T) => string | null;
  /** Render side panel preview (wide mode). Receives available width for truncation. */
  renderSidePreview?: (item: T, width: number) => React.ReactNode;
  /** Extra hints to show in status bar */
  extraHints?: Hint[];
  /** Title shown in header */
  title: string;
  /** Keyboard active (set false when search bar is open) */
  keyboardActive?: boolean;
}

// Chrome lines: header(1) + status bar(1)
const CHROME_LINES = 2;
// Inline preview: separator(1) + text(1) + separator(1)
const PREVIEW_LINES = 3;

/**
 * Keyboard-navigable list with viewport clipping, inline preview (narrow),
 * and dual-pane preview (wide). Triggers lazy load near bottom.
 */
export function InteractiveList<T>({
  items, columns, total, loading, error, hasMore,
  onLoadMore, onSelect, onSearch, onQuit, onRetry,
  renderPreview, renderSidePreview,
  extraHints, title, keyboardActive = true,
}: InteractiveListProps<T>) {
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const { columns: termCols, rows: termRows, isWide } = useTerminalSize();
  const t = getLocale();

  // Calculate viewport height
  const viewportHeight = Math.max(3, termRows - CHROME_LINES - (isWide ? 0 : PREVIEW_LINES));

  // Clamp cursor when items change
  useEffect(() => {
    if (cursor >= items.length && items.length > 0) {
      setCursor(items.length - 1);
    }
  }, [items.length]);

  // Auto-load more when cursor is near bottom
  useEffect(() => {
    if (cursor >= items.length - 5 && hasMore && !loading) {
      onLoadMore();
    }
  }, [cursor, items.length, hasMore, loading]);

  const handleAction = useCallback((action: KeyAction) => {
    switch (action) {
      case 'up':
        setCursor(prev => {
          const next = Math.max(0, prev - 1);
          if (next < scrollOffset) setScrollOffset(next);
          return next;
        });
        break;
      case 'down':
        setCursor(prev => {
          const next = Math.min(items.length - 1, prev + 1);
          if (next >= scrollOffset + viewportHeight) setScrollOffset(next - viewportHeight + 1);
          return next;
        });
        break;
      case 'enter':
        if (items.length > 0) onSelect(items[cursor], cursor);
        break;
      case 'search':
        onSearch?.();
        break;
      case 'quit':
      case 'escape':
        onQuit();
        break;
      case 'retry':
        onRetry?.();
        break;
    }
  }, [items, cursor, scrollOffset, viewportHeight, onSelect, onSearch, onQuit, onRetry]);

  useKeyboard({ active: keyboardActive, onAction: handleAction });

  // Build status bar hints
  const hints: Hint[] = [
    { key: '↑↓', label: t.hints.move.split(':')[1] },
    { key: 'Enter', label: t.hints.open.split(':')[1] },
  ];
  if (onSearch) hints.push({ key: '/', label: t.hints.search.split(':')[1] });
  hints.push({ key: 'q', label: t.hints.quit.split(':')[1] });
  if (extraHints) hints.push(...extraHints);

  // Visible slice
  const visibleItems = items.slice(scrollOffset, scrollOffset + viewportHeight);
  const selectedItem = items[cursor] ?? null;

  // Available width for list content (account for prefix " ▸ " = 3 chars)
  const listPanelWidth = isWide ? Math.floor(termCols * 0.4) : termCols;
  const availableListWidth = listPanelWidth - 3;

  // Filter columns that fit: drop optional columns (marked via priority) when space is tight
  const visibleColumns = (() => {
    const totalFixed = columns.reduce((s, c) => s + (c.width || 10), 0) + (columns.length - 1) * 2;
    if (totalFixed <= availableListWidth) return columns;
    // Drop columns from the end until they fit, but always keep at least 2
    const result = [...columns];
    while (result.length > 2) {
      const tryTotal = result.reduce((s, c) => s + (c.width || 10), 0) + (result.length - 1) * 2;
      if (tryTotal <= availableListWidth) break;
      // Remove second-to-last (keep first and last which are usually ID and date)
      result.splice(result.length - 2, 1);
    }
    return result;
  })();

  // Calculate column widths, shrinking title to fill remaining space
  const colWidths = visibleColumns.map((col, i) => {
    if (col.width) return col.width;
    // Auto-width column (typically title): fill remaining space
    const fixedTotal = visibleColumns.reduce((s, c, j) => j === i ? s : s + (c.width || 10), 0)
      + (visibleColumns.length - 1) * 2;
    return Math.max(8, availableListWidth - fixedTotal);
  });

  // Render a single row
  function renderRow(item: T, index: number) {
    const globalIndex = scrollOffset + index;
    const isSelected = globalIndex === cursor;
    const cells = visibleColumns.map((col, ci) => {
      const raw = String(col.accessor(item));
      return truncate(raw, colWidths[ci]);
    });

    const line = cells.map((cell, ci) => {
      const padded = cell + ' '.repeat(Math.max(0, colWidths[ci] - displayWidth(cell)));
      return padded;
    }).join('  ');

    // Final safety truncation to prevent any terminal wrapping
    const rowText = truncate(line, availableListWidth);

    return (
      <Text key={globalIndex} inverse={isSelected} wrap="truncate">
        {isSelected ? ' ▸ ' : '   '}{rowText}
      </Text>
    );
  }

  // Inline preview for narrow mode — fixed height, always at bottom
  function renderInlinePreview() {
    if (isWide || !renderPreview) return null;
    const previewText = selectedItem ? renderPreview(selectedItem) : null;
    const sepLine = '┄'.repeat(Math.min(termCols - 2, 60));
    const maxPreviewWidth = termCols - 4;
    return (
      <Box flexDirection="column" height={PREVIEW_LINES}>
        <Text dimColor> {sepLine}</Text>
        {previewText ? (
          <Text dimColor> {truncate(previewText, maxPreviewWidth)}</Text>
        ) : (
          <Text> </Text>
        )}
        <Text dimColor> {sepLine}</Text>
      </Box>
    );
  }

  // Wide mode: side-by-side layout
  if (isWide && renderSidePreview) {
    const listWidth = Math.floor(termCols * 0.4);
    const previewWidth = termCols - listWidth - 3;

    return (
      <Box flexDirection="column" height={termRows}>
        {/* Header */}
        <Box>
          <Text bold> {title} ({total})</Text>
          <Box flexGrow={1} />
          {loading && <Text color="yellow">⟳ </Text>}
        </Box>

        {/* Main content area */}
        <Box flexGrow={1}>
          {/* Left: List */}
          <Box flexDirection="column" width={listWidth} overflow="hidden">
            {visibleItems.map((item, i) => renderRow(item, i))}
            {items.length === 0 && !loading && (
              <Text dimColor>   {error ? `${t.loadFailed}: ${error}` : t.noNotes}</Text>
            )}
          </Box>

          {/* Separator */}
          <Text dimColor>│</Text>

          {/* Right: Preview */}
          <Box flexDirection="column" width={previewWidth} paddingLeft={1}>
            {selectedItem && renderSidePreview(selectedItem, previewWidth - 2)}
          </Box>
        </Box>

        {/* Status bar */}
        <StatusBar
          info={items.length > 0 ? t.pageInfo(cursor + 1, total) : undefined}
          hints={hints}
        />
      </Box>
    );
  }

  // Narrow mode: list + inline preview
  return (
    <Box flexDirection="column" height={termRows}>
      {/* Header */}
      <Box>
        <Text bold> {title} ({total})</Text>
        <Box flexGrow={1} />
        {loading && <Text color="yellow">⟳ </Text>}
      </Box>

      {/* List — fixed height to keep preview position stable */}
      <Box flexDirection="column" height={viewportHeight} overflow="hidden">
        {visibleItems.map((item, i) => renderRow(item, i))}
        {items.length === 0 && !loading && !error && (
          <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
            <Text dimColor>{t.noNotes}</Text>
            <Text dimColor>{t.noNotesHint}</Text>
          </Box>
        )}
        {error && (
          <Box paddingLeft={2} paddingTop={1}>
            <Text color="red">{t.loadFailed}: {error}</Text>
            {onRetry && <Text dimColor> (r: {t.hints.retry.split(':')[1]})</Text>}
          </Box>
        )}
      </Box>

      {/* Inline preview — fixed at bottom */}
      {renderInlinePreview()}

      {/* Status bar */}
      <StatusBar
        info={items.length > 0 ? t.pageInfo(cursor + 1, total) : undefined}
        hints={hints}
      />
    </Box>
  );
}
