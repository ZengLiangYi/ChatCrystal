import { useState, useEffect } from 'react';

export interface TerminalSize {
  columns: number;
  rows: number;
  isWide: boolean; // ≥120 columns → dual-pane layout
}

const WIDE_THRESHOLD = 120;
export const MIN_WIDTH = 60;
export const MIN_HEIGHT = 10;

function getSize(): TerminalSize {
  const columns = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  return {
    columns,
    rows,
    isWide: columns >= WIDE_THRESHOLD,
  };
}

/**
 * Track terminal dimensions. Updates on resize events.
 * Returns current size + isWide flag for layout decisions.
 */
export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(getSize);

  useEffect(() => {
    function onResize() {
      setSize(getSize());
    }
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);

  return size;
}
