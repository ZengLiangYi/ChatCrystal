import { useState, useCallback } from 'react';

export interface ViewState {
  /** Unique view type name */
  type: string;
  /** Arbitrary props/data for this view */
  props: Record<string, unknown>;
}

interface UseViewStackReturn {
  /** Current (topmost) view */
  current: ViewState;
  /** Number of views in stack */
  depth: number;
  /** Push a new view onto the stack */
  push: (view: ViewState) => void;
  /** Pop the top view, returning to previous. No-op if at root. */
  pop: () => void;
  /** Replace current view (same depth) */
  replace: (view: ViewState) => void;
}

/**
 * Simple view stack for managing navigation history.
 * The root view is always at index 0 and cannot be popped.
 */
export function useViewStack(initialView: ViewState): UseViewStackReturn {
  const [stack, setStack] = useState<ViewState[]>([initialView]);

  const push = useCallback((view: ViewState) => {
    setStack(prev => [...prev, view]);
  }, []);

  const pop = useCallback(() => {
    setStack(prev => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const replace = useCallback((view: ViewState) => {
    setStack(prev => [...prev.slice(0, -1), view]);
  }, []);

  const current = stack[stack.length - 1];

  return { current, depth: stack.length, push, pop, replace };
}
