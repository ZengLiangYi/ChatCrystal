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

  // Available width for list content (prefix " ▸ " = 3 chars)
  const listPanelWidth = isWide ? Math.floor(termCols * 0.4) : termCols;
  const availableListWidth = listPanelWidth - 3;

  // Column layout: flex column (no width) fills remaining space.
  // Drop fixed-width columns from the right when flex column would be too narrow.
  const MIN_FLEX_WIDTH = 12;

  const { visibleColumns, colWidths } = (() => {
    // Find the flex column (first column without explicit width)
    const flexIdx = columns.findIndex(c => !c.width);

    // Start with all columns, drop rightmost fixed columns until flex has enough space
    let cols = [...columns];
    const calcFlexWidth = (arr: typeof columns) => {
      const fixedSum = arr.reduce((s, c, i) => i === flexIdx ? s : s + (c.width || 10), 0);
      const gaps = (arr.length - 1) * 2;
      return availableListWidth - fixedSum - gaps;
    };

    // Drop from the right, but never drop the flex column
    while (cols.length > 1 && (flexIdx < 0 || calcFlexWidth(cols) < MIN_FLEX_WIDTH)) {
      // Find rightmost droppable column (not the flex column)
      let dropIdx = -1;
      for (let i = cols.length - 1; i >= 0; i--) {
        if (i !== flexIdx && cols[i].width) { dropIdx = i; break; }
      }
      if (dropIdx < 0) break;
      cols.splice(dropIdx, 1);
    }

    // Compute final widths
    const widths = cols.map((col, i) => {
      if (col.width) return col.width;
      // Flex column: fill remaining space
      const fixedSum = cols.reduce((s, c, j) => j === i ? s : s + (c.width || 10), 0);
      const gaps = (cols.length - 1) * 2;
      return Math.max(MIN_FLEX_WIDTH, availableListWidth - fixedSum - gaps);
    });

    return { visibleColumns: cols, colWidths: widths };
  })();

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

    // Truncate to prevent wrapping, then pad to fill width (for inverse highlight)
    const rowText = truncate(line, availableListWidth);
    const pad = Math.max(0, availableListWidth - displayWidth(rowText));

    return (
      <Text key={globalIndex} inverse={isSelected} wrap="truncate">
        {isSelected ? ' ▸ ' : '   '}{rowText}{pad > 0 ? ' '.repeat(pad) : ''}
      </Text>
    );
  }

  // Inline preview for narrow mode — fixed height, pinned at bottom
  function renderInlinePreview() {
    if (isWide || !renderPreview) return null;
    const previewText = selectedItem ? renderPreview(selectedItem) : null;
    const previewContentWidth = termCols - 2; // 1 char padding each side
    const sepLine = '┄'.repeat(previewContentWidth);
    return (
      <Box flexDirection="column" height={PREVIEW_LINES}>
        <Text dimColor> {sepLine}</Text>
        {previewText ? (
          <Text dimColor> {truncate(previewText, previewContentWidth)}</Text>
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
