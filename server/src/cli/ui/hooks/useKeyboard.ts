import { useInput } from 'ink';

export type KeyAction =
  | 'up' | 'down' | 'left' | 'right'
  | 'enter' | 'escape' | 'quit'
  | 'search' | 'home' | 'end'
  | 'retry'
  | 'summarize';

interface UseKeyboardOptions {
  /** Set false to disable key handling (e.g., when SearchBar has focus) */
  active?: boolean;
  onAction: (action: KeyAction) => void;
}

/**
 * Unified keyboard handler. Maps physical keys to semantic actions.
 * Arrow keys are primary; j/k/h/l are vim aliases (not shown in hints).
 */
export function useKeyboard({ active = true, onAction }: UseKeyboardOptions): void {
  useInput((input, key) => {
    if (!active) return;

    // Arrow keys
    if (key.upArrow) return onAction('up');
    if (key.downArrow) return onAction('down');
    if (key.leftArrow) return onAction('left');
    if (key.rightArrow) return onAction('right');

    // Enter / Return
    if (key.return) return onAction('enter');

    // Escape
    if (key.escape) return onAction('escape');

    // Special keys
    if (input === 'q') return onAction('quit');
    if (input === '/') return onAction('search');
    if (input === 'r') return onAction('retry');
    if (input === 's') return onAction('summarize');

    // Vim aliases
    if (input === 'j') return onAction('down');
    if (input === 'k') return onAction('up');
    if (input === 'h') return onAction('left');
    if (input === 'l') return onAction('right');
  }, { isActive: active });
}
